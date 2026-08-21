import {
  DBType,
  VisualFilterCondition,
  VisualJoinInfo,
  VisualSortCondition,
  JoinType,
  VisualFilterOperator,
} from "../types";

export interface VisualTableSelection {
  tableName: string;
  selectedColumns: string[];
  allColumns?: string[];
}

export interface BuildVisualSqlParams {
  tables: VisualTableSelection[];
  joins: VisualJoinInfo[];
  filters: VisualFilterCondition[];
  sorts: VisualSortCondition[];
  limit?: number;
  dbType?: DBType;
}

export function quoteIdent(ident: string, dbType: DBType = "mariadb"): string {
  if (!ident) return "";
  if (dbType === "mariadb") {
    return `\`${ident.replace(/`/g, "``")}\``;
  }
  return `"${ident.replace(/"/g, '""')}"`;
}

export function escapeSqlString(val: string): string {
  return val.replace(/'/g, "''");
}

export function buildVisualSql({
  tables,
  joins,
  filters,
  sorts,
  limit = 50,
  dbType = "mariadb",
}: BuildVisualSqlParams): string {
  if (!tables || tables.length === 0) {
    return "-- Drag or add tables onto the canvas to start building your query";
  }

  // 1. SELECT clause
  const selectItems: string[] = [];
  let hasMultipleTables = tables.length > 1;

  for (const tbl of tables) {
    if (tbl.selectedColumns.length === 0) continue;
    for (const col of tbl.selectedColumns) {
      const qTbl = quoteIdent(tbl.tableName, dbType);
      const qCol = quoteIdent(col, dbType);
      if (hasMultipleTables) {
        selectItems.push(`${qTbl}.${qCol}`);
      } else {
        selectItems.push(`${qCol}`);
      }
    }
  }

  const selectClause =
    selectItems.length > 0 ? selectItems.join(",\n  ") : "*";

  // 2. FROM & JOIN clauses
  // Build adjacency/graph of joins
  const joinedTableSet = new Set<string>();
  let fromClause = "";

  if (tables.length === 1) {
    fromClause = quoteIdent(tables[0].tableName, dbType);
  } else {
    // Start with the first table that appears in joins or first table
    const startTable = tables[0].tableName;
    fromClause = quoteIdent(startTable, dbType);
    joinedTableSet.add(startTable);

    // Iteratively resolve joins
    const remainingJoins = [...joins];
    let progress = true;

    while (remainingJoins.length > 0 && progress) {
      progress = false;
      for (let i = 0; i < remainingJoins.length; i++) {
        const j = remainingJoins[i];
        const fromIn = joinedTableSet.has(j.fromTable);
        const toIn = joinedTableSet.has(j.toTable);

        if (fromIn && !toIn) {
          const joinKeyword =
            j.joinType === "INNER"
              ? "INNER JOIN"
              : j.joinType === "LEFT"
              ? "LEFT JOIN"
              : j.joinType === "RIGHT"
              ? "RIGHT JOIN"
              : "FULL OUTER JOIN";

          fromClause += `\n${joinKeyword} ${quoteIdent(j.toTable, dbType)} ON ${quoteIdent(j.fromTable, dbType)}.${quoteIdent(j.fromColumn, dbType)} = ${quoteIdent(j.toTable, dbType)}.${quoteIdent(j.toColumn, dbType)}`;
          joinedTableSet.add(j.toTable);
          remainingJoins.splice(i, 1);
          progress = true;
          break;
        } else if (!fromIn && toIn) {
          const joinKeyword =
            j.joinType === "INNER"
              ? "INNER JOIN"
              : j.joinType === "LEFT"
              ? "LEFT JOIN"
              : j.joinType === "RIGHT"
              ? "RIGHT JOIN"
              : "FULL OUTER JOIN";

          fromClause += `\n${joinKeyword} ${quoteIdent(j.fromTable, dbType)} ON ${quoteIdent(j.toTable, dbType)}.${quoteIdent(j.toColumn, dbType)} = ${quoteIdent(j.fromTable, dbType)}.${quoteIdent(j.fromColumn, dbType)}`;
          joinedTableSet.add(j.fromTable);
          remainingJoins.splice(i, 1);
          progress = true;
          break;
        } else if (fromIn && toIn) {
          // Already in FROM, additional join condition
          remainingJoins.splice(i, 1);
          progress = true;
          break;
        }
      }
    }

    // Add any remaining unjoined tables (Cartesian / Cross join style)
    for (const tbl of tables) {
      if (!joinedTableSet.has(tbl.tableName)) {
        fromClause += `,\n  ${quoteIdent(tbl.tableName, dbType)}`;
        joinedTableSet.add(tbl.tableName);
      }
    }
  }

  // 3. WHERE clause
  const validFilters = (filters || []).filter(
    (f) => f.table && f.column && f.operator
  );

  let whereClause = "";
  if (validFilters.length > 0) {
    const filterClauses = validFilters.map((f, idx) => {
      const qCol = hasMultipleTables
        ? `${quoteIdent(f.table, dbType)}.${quoteIdent(f.column, dbType)}`
        : quoteIdent(f.column, dbType);

      let cond = "";
      if (f.operator === "IS NULL" || f.operator === "IS NOT NULL") {
        cond = `${qCol} ${f.operator}`;
      } else if (f.operator === "IN") {
        const valStr = f.value
          .split(",")
          .map((v) => `'${escapeSqlString(v.trim())}'`)
          .join(", ");
        cond = `${qCol} IN (${valStr})`;
      } else if (f.operator === "LIKE" || f.operator === "NOT LIKE") {
        cond = `${qCol} ${f.operator} '${escapeSqlString(f.value)}'`;
      } else {
        // Numeric or String comparison
        const isNum =
          f.value !== "" && !isNaN(Number(f.value)) && !f.value.includes(" ");
        const formattedVal = isNum
          ? f.value
          : `'${escapeSqlString(f.value)}'`;
        cond = `${qCol} ${f.operator} ${formattedVal}`;
      }

      if (idx === 0) {
        return cond;
      }
      return `${f.logic || "AND"} ${cond}`;
    });

    whereClause = "\nWHERE " + filterClauses.join("\n  ");
  }

  // 4. ORDER BY clause
  const validSorts = (sorts || []).filter((s) => s.table && s.column);
  let orderByClause = "";
  if (validSorts.length > 0) {
    const sortItems = validSorts.map((s) => {
      const qCol = hasMultipleTables
        ? `${quoteIdent(s.table, dbType)}.${quoteIdent(s.column, dbType)}`
        : quoteIdent(s.column, dbType);
      return `${qCol} ${s.direction}`;
    });
    orderByClause = "\nORDER BY " + sortItems.join(", ");
  }

  // 5. LIMIT clause
  let limitClause = "";
  if (limit && limit > 0) {
    limitClause = `\nLIMIT ${limit}`;
  }

  return `SELECT\n  ${selectClause}\nFROM\n  ${fromClause}${whereClause}${orderByClause}${limitClause};`;
}

// -------------------------------------------------------------
// Smart Heuristic Join Detection Algorithm
// -------------------------------------------------------------

export interface ColumnInfoLike {
  name: string;
  type?: string;
  primaryKey?: boolean;
}

export interface SmartJoinMatch {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  score: number;
  reason: string;
}

/**
 * Basic English singular converter for database table naming conventions
 */
export function toSingular(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith("ies") && w.length > 4) {
    return w.slice(0, -3) + "y"; // categories -> category, companies -> company
  }
  if (w.endsWith("ses") || w.endsWith("xes") || w.endsWith("shes") || w.endsWith("ches")) {
    return w.slice(0, -2); // statuses -> status, boxes -> box
  }
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("is") && !w.endsWith("us") && w.length > 2) {
    return w.slice(0, -1); // users -> user, orders -> order, items -> item
  }
  return w;
}

/**
 * Determine broad data type category for compatibility check
 */
export function getTypeCategory(typeStr?: string): "number" | "text" | "datetime" | "boolean" | "geom" | "other" {
  if (!typeStr) return "other";
  const t = typeStr.toLowerCase();

  if (
    t.includes("int") ||
    t.includes("serial") ||
    t.includes("dec") ||
    t.includes("numeric") ||
    t.includes("float") ||
    t.includes("double") ||
    t.includes("real") ||
    t.includes("number")
  ) {
    return "number";
  }

  if (
    t.includes("char") ||
    t.includes("text") ||
    t.includes("string") ||
    t.includes("uuid") ||
    t.includes("guid") ||
    t.includes("clob")
  ) {
    return "text";
  }

  if (t.includes("date") || t.includes("time") || t.includes("timestamp")) {
    return "datetime";
  }

  if (t.includes("bool") || t.includes("bit")) {
    return "boolean";
  }

  if (
    t.includes("geom") ||
    t.includes("point") ||
    t.includes("polygon") ||
    t.includes("linestring")
  ) {
    return "geom";
  }

  return "other";
}

/**
 * Check if two columns are data-type compatible for joining
 */
export function areTypesCompatible(typeA?: string, typeB?: string): boolean {
  if (!typeA || !typeB) return true; // If type is missing, allow heuristic
  const catA = getTypeCategory(typeA);
  const catB = getTypeCategory(typeB);

  if (catA === "other" || catB === "other") return true;
  return catA === catB;
}

/**
 * Evaluates the best candidate column pair to JOIN between Table A and Table B
 */
export function findSmartJoinMatch(
  tableA: string,
  colsA: ColumnInfoLike[],
  tableB: string,
  colsB: ColumnInfoLike[]
): SmartJoinMatch | null {
  if (!tableA || !tableB || tableA === tableB || !colsA?.length || !colsB?.length) {
    return null;
  }

  const singA = toSingular(tableA);
  const singB = toSingular(tableB);
  const rawA = tableA.toLowerCase();
  const rawB = tableB.toLowerCase();

  let bestMatch: SmartJoinMatch | null = null;
  let highestScore = 0;

  for (const ca of colsA) {
    const nameA = ca.name.toLowerCase();
    const isPkA = !!ca.primaryKey || nameA === "id";

    for (const cb of colsB) {
      const nameB = cb.name.toLowerCase();
      const isPkB = !!cb.primaryKey || nameB === "id";

      // Ensure data types are not conflicting (e.g. datetime vs int)
      if (!areTypesCompatible(ca.type, cb.type)) {
        continue;
      }

      let score = 0;
      let reason = "";

      // Rule 1: TableA PK -> TableB with singular TableA + _id
      // e.g. users.id <-> orders.user_id
      if (isPkA && (nameB === `${singA}_id` || nameB === `${rawA}_id` || nameB === `id_${singA}` || nameB === `id_${rawA}`)) {
        score = 100;
        reason = `Matches ${tableA} primary key with foreign key ${cb.name}`;
      }
      // Reverse: TableB PK -> TableA with singular TableB + _id
      else if (isPkB && (nameA === `${singB}_id` || nameA === `${rawB}_id` || nameA === `id_${singB}` || nameA === `id_${rawB}`)) {
        score = 100;
        reason = `Matches ${tableB} primary key with foreign key ${ca.name}`;
      }
      // Rule 2: TableA PK -> TableB with prefixed/suffixed foreign key (e.g. parent_user_id, customer_user_id)
      else if (isPkA && (nameB.endsWith(`_${singA}_id`) || nameB.endsWith(`_${rawA}_id`))) {
        score = 88;
        reason = `Contextual foreign key (${cb.name}) references ${tableA}`;
      }
      else if (isPkB && (nameA.endsWith(`_${singB}_id`) || nameA.endsWith(`_${rawB}_id`))) {
        score = 88;
        reason = `Contextual foreign key (${ca.name}) references ${tableB}`;
      }
      // Rule 3: Exact same column name with identifying key suffixes (_id, _code, _no, _key, _uuid, _ref, _num, sku)
      else if (nameA === nameB && (
        nameA.endsWith("_id") ||
        nameA.endsWith("_code") ||
        nameA.endsWith("_no") ||
        nameA.endsWith("_key") ||
        nameA.endsWith("_uuid") ||
        nameA.endsWith("_guid") ||
        nameA.endsWith("_ref") ||
        nameA.endsWith("_num") ||
        nameA === "sku" ||
        nameA === "code" ||
        nameA === "ref_no"
      )) {
        score = 80;
        reason = `Identical identifier column name: ${ca.name}`;
      }
      // Rule 4: Both are PKs with exact same name (e.g. 1:1 relation or inherited table)
      else if (isPkA && isPkB && nameA === nameB) {
        score = 75;
        reason = `Both tables share primary key: ${ca.name}`;
      }
      // Rule 5: TableA PK -> TableB with singular TableA + _code or _no (e.g. customer_code)
      else if (isPkA && (nameB === `${singA}_code` || nameB === `${singA}_no` || nameB === `${rawA}_code` || nameB === `${rawA}_no`)) {
        score = 70;
        reason = `Code/Number identifier (${cb.name}) references ${tableA}`;
      }
      else if (isPkB && (nameA === `${singB}_code` || nameA === `${singB}_no` || nameA === `${rawB}_code` || nameA === `${rawB}_no`)) {
        score = 70;
        reason = `Code/Number identifier (${ca.name}) references ${tableB}`;
      }

      if (score > highestScore) {
        highestScore = score;
        // Direct convention: from PK to FK or from A to B
        if (isPkA && !isPkB) {
          bestMatch = {
            fromTable: tableA,
            fromColumn: ca.name,
            toTable: tableB,
            toColumn: cb.name,
            score,
            reason,
          };
        } else if (!isPkA && isPkB) {
          bestMatch = {
            fromTable: tableB,
            fromColumn: cb.name,
            toTable: tableA,
            toColumn: ca.name,
            score,
            reason,
          };
        } else {
          bestMatch = {
            fromTable: tableA,
            fromColumn: ca.name,
            toTable: tableB,
            toColumn: cb.name,
            score,
            reason,
          };
        }
      }
    }
  }

  return bestMatch;
}

// -------------------------------------------------------------
// Bidirectional SQL Parser (SQL -> Visual Query State)
// -------------------------------------------------------------

export interface ParsedVisualSql {
  tables: VisualTableSelection[];
  joins: VisualJoinInfo[];
  filters: VisualFilterCondition[];
  sorts: VisualSortCondition[];
  limit: number;
}

function cleanIdentifier(s: string): string {
  if (!s) return "";
  return s.replace(/^["`\[]+|["`\]]+$/g, "").trim();
}

/**
 * Parses a standard SQL SELECT statement and extracts visual elements:
 * Tables, Selected Columns, JOINs, WHERE Filters, Sorts, and Limit.
 */
export function parseSqlToVisual(
  sqlStr: string,
  tableSchemas: Record<string, ColumnInfoLike[]> = {}
): ParsedVisualSql | null {
  if (!sqlStr || !sqlStr.trim()) return null;

  // 1. Remove comments and trim
  const cleanSql = sqlStr
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim()
    .replace(/;+\s*$/, "");

  // Must be a SELECT statement
  if (!/^SELECT\b/i.test(cleanSql)) {
    return null;
  }

  // 2. Extract clauses using regex
  const selectMatch = cleanSql.match(/^SELECT\s+([\s\S]+?)\s+FROM\s+/i);
  if (!selectMatch) return null;

  const selectPart = selectMatch[1].trim();
  const fromAndBeyond = cleanSql.slice(selectMatch[0].length - 5); // starts with "FROM ..."

  // Split remaining query into major SQL clause sections
  const whereIndex = fromAndBeyond.search(/\bWHERE\b/i);
  const groupIndex = fromAndBeyond.search(/\bGROUP\s+BY\b/i);
  const orderIndex = fromAndBeyond.search(/\bORDER\s+BY\b/i);
  const limitIndex = fromAndBeyond.search(/\bLIMIT\b/i);

  // Determine boundaries
  const fromEnd = [whereIndex, groupIndex, orderIndex, limitIndex, fromAndBeyond.length]
    .filter((pos) => pos !== -1)
    .sort((a, b) => a - b)[0];

  const fromAndJoinPart = fromAndBeyond.slice(5, fromEnd).trim(); // without "FROM "

  let wherePart = "";
  if (whereIndex !== -1) {
    const whereEnd = [groupIndex, orderIndex, limitIndex, fromAndBeyond.length]
      .filter((pos) => pos > whereIndex)
      .sort((a, b) => a - b)[0];
    wherePart = fromAndBeyond.slice(whereIndex + 5, whereEnd).trim(); // without "WHERE "
  }

  let orderPart = "";
  if (orderIndex !== -1) {
    const orderEnd = [limitIndex, fromAndBeyond.length]
      .filter((pos) => pos > orderIndex)
      .sort((a, b) => a - b)[0];
    orderPart = fromAndBeyond.slice(orderIndex + 8, orderEnd).trim(); // without "ORDER BY "
  }

  let limitVal = 50;
  if (limitIndex !== -1) {
    const limitMatch = fromAndBeyond.slice(limitIndex).match(/\bLIMIT\s+(\d+)/i);
    if (limitMatch) {
      limitVal = parseInt(limitMatch[1], 10);
    }
  }

  // 3. Parse FROM and JOINs
  const aliasMap: Record<string, string> = {}; // alias -> realTableName
  const tableOrder: string[] = [];
  const joins: VisualJoinInfo[] = [];

  // Match all JOIN occurrences using lookahead for the next clause
  const joinRegex = /\b(INNER|LEFT|RIGHT|FULL(?:\s+OUTER)?)?\s*JOIN\s+([`"a-zA-Z0-9_.]+)(?:\s+(?:AS\s+)?([`"a-zA-Z0-9_]+))?\s+ON\s+([\s\S]+?)(?=\s+\b(?:INNER|LEFT|RIGHT|FULL(?:\s+OUTER)?\s+)?JOIN\b|\s+\bWHERE\b|\s+\bGROUP\s+BY\b|\s+\bORDER\s+BY\b|\s+\bLIMIT\b|;|$)/gi;
  
  const firstJoinMatch = fromAndJoinPart.match(/\b(?:(?:INNER|LEFT|RIGHT|FULL(?:\s+OUTER)?)\s+)?JOIN\b/i);
  const firstJoinIdx = firstJoinMatch ? firstJoinMatch.index! : -1;

  const baseFromPart = firstJoinIdx !== -1 ? fromAndJoinPart.slice(0, firstJoinIdx).trim() : fromAndJoinPart;

  // Handle multiple comma-separated tables in base FROM
  const fromTables = baseFromPart.split(",").map((t) => t.trim()).filter(Boolean);
  for (const ft of fromTables) {
    const parts = ft.split(/\s+(?:AS\s+)?/i);
    const rawTbl = cleanIdentifier(parts[0]);
    if (rawTbl) {
      if (!tableOrder.includes(rawTbl)) tableOrder.push(rawTbl);
      aliasMap[rawTbl.toLowerCase()] = rawTbl;
      if (parts[1]) {
        aliasMap[cleanIdentifier(parts[1]).toLowerCase()] = rawTbl;
      }
    }
  }

  // Parse each JOIN
  let joinMatch: RegExpExecArray | null;
  while ((joinMatch = joinRegex.exec(fromAndJoinPart)) !== null) {
    const rawType = (joinMatch[1] || "INNER").toUpperCase().replace(/\s+OUTER/, "");
    const joinType: JoinType = (["LEFT", "RIGHT", "FULL"].includes(rawType) ? rawType : "INNER") as JoinType;
    const rawTbl = cleanIdentifier(joinMatch[2]);
    const alias = joinMatch[3] ? cleanIdentifier(joinMatch[3]) : "";
    const onCond = joinMatch[4].trim();

    if (rawTbl && !tableOrder.includes(rawTbl)) {
      tableOrder.push(rawTbl);
    }
    if (rawTbl) {
      aliasMap[rawTbl.toLowerCase()] = rawTbl;
    }
    if (alias) {
      aliasMap[alias.toLowerCase()] = rawTbl;
    }

    // Parse ON condition: tableA.colA = tableB.colB
    const onSides = onCond.split("=");
    if (onSides.length === 2) {
      const leftRaw = onSides[0].trim();
      const rightRaw = onSides[1].trim();

      const leftParts = leftRaw.split(".");
      const rightParts = rightRaw.split(".");

      let fromTbl = "";
      let fromCol = "";
      let toTbl = rawTbl;
      let toCol = "";

      if (leftParts.length === 2) {
        const t = aliasMap[cleanIdentifier(leftParts[0]).toLowerCase()] || cleanIdentifier(leftParts[0]);
        const c = cleanIdentifier(leftParts[1]);
        if (t.toLowerCase() === rawTbl.toLowerCase()) {
          toCol = c;
        } else {
          fromTbl = t;
          fromCol = c;
        }
      }

      if (rightParts.length === 2) {
        const t = aliasMap[cleanIdentifier(rightParts[0]).toLowerCase()] || cleanIdentifier(rightParts[0]);
        const c = cleanIdentifier(rightParts[1]);
        if (t.toLowerCase() === rawTbl.toLowerCase()) {
          toCol = c;
        } else {
          fromTbl = t;
          fromCol = c;
        }
      }

      if (!fromTbl && tableOrder.length > 0) {
        fromTbl = tableOrder[0];
      }

      if (fromTbl && toTbl && fromCol && toCol) {
        joins.push({
          id: `join-${fromTbl}-${fromCol}-${toTbl}-${toCol}-${joins.length}`,
          joinType,
          fromTable: fromTbl,
          fromColumn: fromCol,
          toTable: toTbl,
          toColumn: toCol,
        });
      }
    }
  }

  // 4. Parse Selected Columns
  const tableColumnSelections: Record<string, Set<string>> = {};
  tableOrder.forEach((t) => {
    tableColumnSelections[t] = new Set();
  });

  const selectItems = selectPart.split(",").map((s) => s.trim()).filter(Boolean);
  const isSelectAll = selectItems.some((s) => s === "*");

  if (isSelectAll) {
    tableOrder.forEach((t) => {
      const schemaCols = tableSchemas[t] || [];
      schemaCols.forEach((c) => tableColumnSelections[t].add(c.name));
    });
  } else {
    for (const item of selectItems) {
      const cleanItem = item.replace(/\s+(?:AS\s+)?[`"a-zA-Z0-9_]+$/i, "").trim(); // strip alias
      if (cleanItem.includes(".")) {
        const [rawT, rawC] = cleanItem.split(".");
        const t = aliasMap[cleanIdentifier(rawT).toLowerCase()] || cleanIdentifier(rawT);
        const c = cleanIdentifier(rawC);

        if (tableColumnSelections[t]) {
          if (c === "*") {
            const schemaCols = tableSchemas[t] || [];
            schemaCols.forEach((col) => tableColumnSelections[t].add(col.name));
          } else {
            tableColumnSelections[t].add(c);
          }
        }
      } else {
        const c = cleanIdentifier(cleanItem);
        // Find which table has this column
        let found = false;
        for (const t of tableOrder) {
          const schemaCols = tableSchemas[t] || [];
          if (schemaCols.some((col) => col.name === c)) {
            tableColumnSelections[t].add(c);
            found = true;
            break;
          }
        }
        if (!found && tableOrder.length > 0) {
          tableColumnSelections[tableOrder[0]].add(c);
        }
      }
    }
  }

  // 5. Parse WHERE conditions
  const filters: VisualFilterCondition[] = [];
  if (wherePart) {
    // Split by AND / OR (case-insensitive)
    const condTokens = wherePart.split(/\s+\b(AND|OR)\b\s+/i);
    let currentLogic: "AND" | "OR" = "AND";

    for (let i = 0; i < condTokens.length; i++) {
      const token = condTokens[i].trim();
      if (!token) continue;

      if (/^AND$/i.test(token)) {
        currentLogic = "AND";
        continue;
      }
      if (/^OR$/i.test(token)) {
        currentLogic = "OR";
        continue;
      }

      // Parse individual filter condition: col OP val
      const opMatch = token.match(/^(.*?)\s+(=|!=|<>|>=|<=|>|<|NOT\s+LIKE|LIKE|IN|IS\s+NOT\s+NULL|IS\s+NULL)\s*(.*)$/i);
      if (opMatch) {
        let rawColStr = cleanIdentifier(opMatch[1]);
        let rawOp = opMatch[2].toUpperCase().replace(/\s+/, " ");
        let rawVal = opMatch[3].trim().replace(/^['"]|['"]$/g, "");

        let op: VisualFilterOperator = "=";
        if (rawOp === "<>") op = "!=";
        else if (["=", "!=", ">", "<", ">=", "<=", "LIKE", "NOT LIKE", "IN", "IS NULL", "IS NOT NULL"].includes(rawOp)) {
          op = rawOp as VisualFilterOperator;
        }

        if (op === "IN") {
          rawVal = rawVal.replace(/^\(|\)$/g, "").replace(/['"]/g, "").trim();
        }

        let targetTable = tableOrder[0] || "";
        let targetCol = rawColStr;

        if (rawColStr.includes(".")) {
          const [tPart, cPart] = rawColStr.split(".");
          targetTable = aliasMap[cleanIdentifier(tPart).toLowerCase()] || cleanIdentifier(tPart);
          targetCol = cleanIdentifier(cPart);
        } else {
          // Find table containing this column
          for (const t of tableOrder) {
            const schemaCols = tableSchemas[t] || [];
            if (schemaCols.some((col) => col.name === targetCol)) {
              targetTable = t;
              break;
            }
          }
        }

        filters.push({
          id: `filter-${Date.now()}-${filters.length}`,
          table: targetTable,
          column: targetCol,
          operator: op,
          value: rawVal,
          logic: filters.length === 0 ? "AND" : currentLogic,
        });
      }
    }
  }

  // 6. Parse ORDER BY
  const sorts: VisualSortCondition[] = [];
  if (orderPart) {
    const sortItems = orderPart.split(",").map((s) => s.trim()).filter(Boolean);
    for (const item of sortItems) {
      const parts = item.split(/\s+/);
      const rawCol = parts[0];
      const dir: "ASC" | "DESC" = parts[1] && /^DESC$/i.test(parts[1]) ? "DESC" : "ASC";

      let targetTable = tableOrder[0] || "";
      let targetCol = cleanIdentifier(rawCol);

      if (rawCol.includes(".")) {
        const [tPart, cPart] = rawCol.split(".");
        targetTable = aliasMap[cleanIdentifier(tPart).toLowerCase()] || cleanIdentifier(tPart);
        targetCol = cleanIdentifier(cPart);
      }

      sorts.push({
        id: `sort-${Date.now()}-${sorts.length}`,
        table: targetTable,
        column: targetCol,
        direction: dir,
      });
    }
  }

  // Build tables array
  const tables: VisualTableSelection[] = tableOrder.map((tableName) => ({
    tableName,
    selectedColumns: Array.from(tableColumnSelections[tableName] || []),
  }));

  return {
    tables,
    joins,
    filters,
    sorts,
    limit: limitVal,
  };
}
