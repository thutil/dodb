import { ColumnInfo } from "../types";

export interface TableAliasInfo {
  alias: string;
  tableName: string;
  schema?: string;
}

export interface SchemaRelation {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export interface DatabaseSchemaInfo {
  tables: string[];
  tableColumns: Map<string, ColumnInfo[]>; // lowercase table name -> columns
  relations?: SchemaRelation[];
}

/**
 * Extracts table names and their aliases from a SQL query string.
 * Supports:
 * - SELECT ... FROM table [AS] alias
 * - ... JOIN table [AS] alias
 * - ... FROM t1 a, t2 b
 * - UPDATE table [AS] alias
 * - INSERT INTO table
 * - DELETE FROM table [AS] alias
 */
export function extractTableAliasesFromSql(sql: string): TableAliasInfo[] {
  if (!sql || !sql.trim()) return [];

  // Strip single-line comments (-- ... and # ...)
  let cleanSql = sql.replace(/--.*$/gm, "").replace(/#.*$/gm, "");
  // Strip multi-line comments (/* ... */)
  cleanSql = cleanSql.replace(/\/\*[\s\S]*?\*\//g, "");

  const aliases: TableAliasInfo[] = [];
  const seenAliases = new Set<string>();

  const addAlias = (rawTable: string, rawAlias?: string) => {
    if (!rawTable) return;
    const cleanTable = rawTable.replace(/["'`]/g, "").trim();
    if (!cleanTable) return;

    // Split schema if qualified (e.g. public.users)
    const parts = cleanTable.split(".");
    const tableName = parts[parts.length - 1];
    const schema = parts.length > 1 ? parts[0] : undefined;

    let alias = rawAlias ? rawAlias.replace(/["'`]/g, "").trim() : "";
    // If alias is a SQL keyword, ignore it as alias
    if (alias && /^(WHERE|ON|JOIN|LEFT|RIGHT|INNER|FULL|CROSS|ORDER|GROUP|HAVING|LIMIT|OFFSET|UNION|VALUES|SET)$/i.test(alias)) {
      alias = "";
    }

    const effectiveAlias = alias || tableName;
    const aliasLower = effectiveAlias.toLowerCase();

    if (!seenAliases.has(aliasLower)) {
      seenAliases.add(aliasLower);
      aliases.push({
        alias: effectiveAlias,
        tableName,
        schema,
      });
    }

    // Also register the bare table name if alias was custom
    if (alias && !seenAliases.has(tableName.toLowerCase())) {
      seenAliases.add(tableName.toLowerCase());
      aliases.push({
        alias: tableName,
        tableName,
        schema,
      });
    }
  };

  // 1. Match FROM and JOIN clauses
  // e.g. FROM table [AS] alias, JOIN table [AS] alias
  const fromJoinRegex = /\b(?:FROM|JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|INNER\s+JOIN|FULL\s+JOIN|CROSS\s+JOIN|STRAIGHT_JOIN)\s+([a-zA-Z0-9_".`]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_"`]+))?/gi;
  let match: RegExpExecArray | null;
  while ((match = fromJoinRegex.exec(cleanSql)) !== null) {
    addAlias(match[1], match[2]);
  }

  // 2. Match UPDATE, INSERT INTO, DELETE FROM
  const dmlRegex = /\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+([a-zA-Z0-9_".`]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_"`]+))?/gi;
  while ((match = dmlRegex.exec(cleanSql)) !== null) {
    addAlias(match[1], match[2]);
  }

  // 3. Match comma separated tables in FROM clause: FROM t1 a, t2 b, t3
  const fromClauseMatch = cleanSql.match(/\bFROM\s+([^;]+?)(?:\bWHERE\b|\bGROUP\b|\bORDER\b|\bHAVING\b|\bLIMIT\b|\bUNION\b|$)/i);
  if (fromClauseMatch && fromClauseMatch[1].includes(",")) {
    const listPart = fromClauseMatch[1];
    const items = listPart.split(",");
    for (const item of items) {
      const itemTrimmed = item.trim();
      const parts = itemTrimmed.split(/\s+/).filter(Boolean);
      if (parts.length === 1) {
        addAlias(parts[0]);
      } else if (parts.length === 2) {
        addAlias(parts[0], parts[1]);
      } else if (parts.length === 3 && parts[1].toUpperCase() === "AS") {
        addAlias(parts[0], parts[2]);
      }
    }
  }

  return aliases;
}

export type AutocompleteContext =
  | { type: "dot"; prefix: string; columnPrefix: string }
  | { type: "table"; filter: string }
  | { type: "on"; filter: string }
  | { type: "general"; word: string };

/**
 * Determine the autocomplete context based on the text before the cursor.
 */
export function getAutocompleteContext(lineUntilCursor: string): AutocompleteContext {
  // 1. Dot-completion: e.g. "p.", "users.", "tbl.col_p"
  const dotMatch = lineUntilCursor.match(/([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]*)$/);
  if (dotMatch) {
    return {
      type: "dot",
      prefix: dotMatch[1],
      columnPrefix: dotMatch[2] || "",
    };
  }

  // 2. Table context: after FROM, JOIN, INTO, UPDATE, TABLE
  const tableMatch = lineUntilCursor.match(
    /\b(FROM|JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+JOIN|CROSS\s+JOIN|INTO|UPDATE|TABLE)\s+([a-zA-Z0-9_]*)$/i
  );
  if (tableMatch) {
    return {
      type: "table",
      filter: tableMatch[2] || "",
    };
  }

  // 3. ON clause context: after ON
  const onMatch = lineUntilCursor.match(/\bON\s+([a-zA-Z0-9_.]*)$/i);
  if (onMatch) {
    return {
      type: "on",
      filter: onMatch[1] || "",
    };
  }

  // 4. General context
  const wordMatch = lineUntilCursor.match(/([a-zA-Z0-9_]*)$/);
  return {
    type: "general",
    word: wordMatch ? wordMatch[1] : "",
  };
}

/**
 * Predicts smart ghost text (inline suggestion) for the current cursor position.
 * 100% offline, zero latency heuristic engine.
 */
export function predictInlineSqlCompletion(
  fullSql: string,
  lineUntilCursor: string,
  schemaInfo: DatabaseSchemaInfo,
  activeTable: string | null
): string | null {
  const lineTrimmed = lineUntilCursor.trim();
  if (!lineTrimmed) return null;

  const tableAliases = extractTableAliasesFromSql(fullSql);
  const defaultTable = activeTable || (schemaInfo.tables && schemaInfo.tables[0]) || "table_name";

  // 1. Join ON Condition (e.g. "... LEFT JOIN provinces as p ON " or "... ON p.")
  const onMatch = lineUntilCursor.match(/\bON\s+([a-zA-Z0-9_.]*)$/i);
  if (onMatch && tableAliases.length >= 2) {
    const currentOnPrefix = onMatch[1] || "";
    const lastAlias = tableAliases[tableAliases.length - 1];
    const prevAlias = tableAliases[tableAliases.length - 2];

    const lastCols = schemaInfo.tableColumns.get(lastAlias.tableName.toLowerCase()) || [];
    const prevCols = schemaInfo.tableColumns.get(prevAlias.tableName.toLowerCase()) || [];

    // Check relations
    let joinExpr: string | null = null;
    if (schemaInfo.relations) {
      for (const rel of schemaInfo.relations) {
        if (
          rel.fromTable.toLowerCase() === lastAlias.tableName.toLowerCase() &&
          rel.toTable.toLowerCase() === prevAlias.tableName.toLowerCase()
        ) {
          joinExpr = `${lastAlias.alias}.${rel.fromColumn} = ${prevAlias.alias}.${rel.toColumn}`;
          break;
        } else if (
          rel.toTable.toLowerCase() === lastAlias.tableName.toLowerCase() &&
          rel.fromTable.toLowerCase() === prevAlias.tableName.toLowerCase()
        ) {
          joinExpr = `${lastAlias.alias}.${rel.toColumn} = ${prevAlias.alias}.${rel.fromColumn}`;
          break;
        }
      }
    }

    // Heuristic join match (e.g. region_id = id or user_id = id)
    if (!joinExpr) {
      const lastSingular = lastAlias.tableName.replace(/s$/, "").toLowerCase();
      const prevSingular = prevAlias.tableName.replace(/s$/, "").toLowerCase();

      for (const lc of lastCols) {
        for (const pc of prevCols) {
          const lName = lc.name.toLowerCase();
          const pName = pc.name.toLowerCase();
          if (
            (lName === `${prevSingular}_id` && pName === "id") ||
            (pName === `${lastSingular}_id` && lName === "id") ||
            (lName === pName && lName.includes("_id")) ||
            (lName === pName && lName === "code")
          ) {
            joinExpr = `${lastAlias.alias}.${lc.name} = ${prevAlias.alias}.${pc.name}`;
            break;
          }
        }
        if (joinExpr) break;
      }
    }

    if (!joinExpr && lastCols.length > 0 && prevCols.length > 0) {
      joinExpr = `${lastAlias.alias}.${lastCols[0].name} = ${prevAlias.alias}.${prevCols[0].name}`;
    }

    if (joinExpr) {
      if (currentOnPrefix) {
        if (joinExpr.toLowerCase().startsWith(currentOnPrefix.toLowerCase())) {
          return joinExpr.slice(currentOnPrefix.length);
        }
      } else {
        return joinExpr;
      }
    }
  }

  // 2. Typing "SELECT " or "select " at line start
  if (/^SELECT\s*$/i.test(lineTrimmed)) {
    return `* FROM ${defaultTable} LIMIT 50;`;
  }

  // 3. Typing "SELECT * FROM "
  if (/^SELECT\s+\*\s+FROM\s*$/i.test(lineTrimmed)) {
    return `${defaultTable} LIMIT 50;`;
  }

  // 4. Typing "SELECT COUNT(" or "count("
  if (/SELECT\s+COUNT\(\s*$/i.test(lineTrimmed)) {
    return `*) FROM ${defaultTable};`;
  }

  // 5. Typing "ORDER BY "
  if (/\bORDER\s+BY\s*$/i.test(lineTrimmed)) {
    const mainTable = tableAliases[0]?.tableName || defaultTable;
    const cols = schemaInfo.tableColumns.get(mainTable.toLowerCase()) || [];
    const pkCol =
      cols.find((c) => c.primaryKey)?.name ||
      (cols.some((c) => c.name === "id")
        ? "id"
        : cols.some((c) => c.name === "created_at")
        ? "created_at"
        : cols[0]?.name || "id");
    const alias =
      tableAliases[0]?.alias && tableAliases[0].alias !== tableAliases[0].tableName
        ? `${tableAliases[0].alias}.`
        : "";
    return `${alias}${pkCol} DESC LIMIT 50;`;
  }

  // 6. Typing "WHERE "
  if (/\bWHERE\s*$/i.test(lineTrimmed)) {
    const mainTable = tableAliases[0]?.tableName || defaultTable;
    const cols = schemaInfo.tableColumns.get(mainTable.toLowerCase()) || [];
    const pkCol = cols.find((c) => c.primaryKey)?.name || (cols.some((c) => c.name === "id") ? "id" : null);
    const alias =
      tableAliases[0]?.alias && tableAliases[0].alias !== tableAliases[0].tableName
        ? `${tableAliases[0].alias}.`
        : "";
    if (pkCol) {
      return `${alias}${pkCol} = 1`;
    }
    const statusCol = cols.find((c) => /status|state/i.test(c.name));
    if (statusCol) {
      return `${alias}${statusCol.name} = 'active'`;
    }
  }

  // 7. Typing "INSERT INTO "
  if (/^INSERT\s+INTO\s*$/i.test(lineTrimmed)) {
    return `${defaultTable} VALUES (...)`;
  }

  // 8. Typing "UPDATE "
  if (/^UPDATE\s*$/i.test(lineTrimmed)) {
    return `${defaultTable} SET ... WHERE id = 1;`;
  }

  // 9. Typing "DELETE FROM "
  if (/^DELETE\s+FROM\s*$/i.test(lineTrimmed)) {
    return `${defaultTable} WHERE id = 1;`;
  }

  return null;
}

