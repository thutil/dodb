/**
 * SQL Utilities for parsing, splitting statements, and finding statements at cursor.
 */

export interface SqlStatement {
  sql: string;
  raw: string;
  startIndex: number;
  endIndex: number;
  startLine: number;
  endLine: number;
}

/**
 * Splits a full SQL script into individual executable statements,
 * safely handling single quotes, double quotes, backticks, dollar quotes ($$...$$),
 * single-line comments (-- and #), and multi-line comments (/* ... *\/).
 */
export function splitSqlStatements(sqlText: string): SqlStatement[] {
  if (!sqlText || !sqlText.trim()) return [];

  const statements: SqlStatement[] = [];
  const len = sqlText.length;
  let i = 0;
  let stmtStart = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;

  // Calculate line numbers as we scan
  const getLineNumberAt = (index: number): number => {
    let lines = 1;
    for (let pos = 0; pos < index && pos < len; pos++) {
      if (sqlText[pos] === "\n") lines++;
    }
    return lines;
  };

  while (i < len) {
    const char = sqlText[i];
    const nextChar = i + 1 < len ? sqlText[i + 1] : "";

    // 1. Inside single-line comment (-- or #)
    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      i++;
      continue;
    }

    // 2. Inside block comment (/* ... */)
    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // 3. Inside single quotes ('...')
    if (inSingleQuote) {
      if (char === "'" && nextChar === "'") {
        // Escaped single quote ('')
        i += 2;
        continue;
      } else if (char === "\\") {
        // Escaped character (\')
        i += 2;
        continue;
      } else if (char === "'") {
        inSingleQuote = false;
      }
      i++;
      continue;
    }

    // 4. Inside double quotes ("...")
    if (inDoubleQuote) {
      if (char === '"' && nextChar === '"') {
        i += 2;
        continue;
      } else if (char === "\\") {
        i += 2;
        continue;
      } else if (char === '"') {
        inDoubleQuote = false;
      }
      i++;
      continue;
    }

    // 5. Inside backticks (`...`)
    if (inBacktick) {
      if (char === "`" && nextChar === "`") {
        i += 2;
        continue;
      } else if (char === "\\") {
        i += 2;
        continue;
      } else if (char === "`") {
        inBacktick = false;
      }
      i++;
      continue;
    }

    // 6. Inside PostgreSQL dollar-quoted string ($$...$$ or $tag$...$tag$)
    if (dollarTag !== null) {
      if (char === "$" && sqlText.substring(i).startsWith(dollarTag)) {
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      i++;
      continue;
    }

    // Check for comment starts
    if (char === "-" && nextChar === "-") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (char === "#") {
      inLineComment = true;
      i++;
      continue;
    }
    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }

    // Check for string literal starts
    if (char === "'") {
      inSingleQuote = true;
      i++;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      i++;
      continue;
    }
    if (char === "`") {
      inBacktick = true;
      i++;
      continue;
    }

    // Check for PostgreSQL dollar quoting start ($tag$ or $$)
    if (char === "$") {
      const match = sqlText.substring(i).match(/^(\$[a-zA-Z0-9_]*\$)/);
      if (match) {
        dollarTag = match[1];
        i += dollarTag.length;
        continue;
      }
    }

    // Semicolon statement boundary
    if (char === ";") {
      const raw = sqlText.substring(stmtStart, i + 1);
      const sql = stripCommentsAndTrim(raw);
      if (sql.length > 0) {
        statements.push({
          sql,
          raw,
          startIndex: stmtStart,
          endIndex: i + 1,
          startLine: getLineNumberAt(stmtStart),
          endLine: getLineNumberAt(i + 1),
        });
      }
      stmtStart = i + 1;
      i++;
      continue;
    }

    i++;
  }

  // Trailing statement without trailing semicolon
  if (stmtStart < len) {
    const raw = sqlText.substring(stmtStart, len);
    const sql = stripCommentsAndTrim(raw);
    if (sql.length > 0) {
      statements.push({
        sql,
        raw,
        startIndex: stmtStart,
        endIndex: len,
        startLine: getLineNumberAt(stmtStart),
        endLine: getLineNumberAt(len),
      });
    }
  }

  return statements;
}

/**
 * Remove comments and leading/trailing semicolons/whitespace from a single statement
 */
export function stripCommentsAndTrim(rawSql: string): string {
  let cleaned = "";
  const len = rawSql.length;
  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < len) {
    const char = rawSql[i];
    const nextChar = i + 1 < len ? rawSql[i + 1] : "";

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        cleaned += "\n";
      }
      i++;
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (inSingleQuote) {
      cleaned += char;
      if (char === "'" && nextChar === "'") {
        cleaned += nextChar;
        i += 2;
        continue;
      } else if (char === "\\") {
        if (nextChar) {
          cleaned += nextChar;
          i += 2;
          continue;
        }
      } else if (char === "'") {
        inSingleQuote = false;
      }
      i++;
      continue;
    }

    if (inDoubleQuote) {
      cleaned += char;
      if (char === '"' && nextChar === '"') {
        cleaned += nextChar;
        i += 2;
        continue;
      } else if (char === "\\") {
        if (nextChar) {
          cleaned += nextChar;
          i += 2;
          continue;
        }
      } else if (char === '"') {
        inDoubleQuote = false;
      }
      i++;
      continue;
    }

    if (inBacktick) {
      cleaned += char;
      if (char === "`" && nextChar === "`") {
        cleaned += nextChar;
        i += 2;
        continue;
      } else if (char === "\\") {
        if (nextChar) {
          cleaned += nextChar;
          i += 2;
          continue;
        }
      } else if (char === "`") {
        inBacktick = false;
      }
      i++;
      continue;
    }

    if (char === "-" && nextChar === "-") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (char === "#") {
      inLineComment = true;
      i++;
      continue;
    }
    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
    } else if (char === '"') {
      inDoubleQuote = true;
    } else if (char === "`") {
      inBacktick = true;
    }

    cleaned += char;
    i++;
  }

  let trimmed = cleaned.trim();
  // Strip trailing semicolon for execution consistency
  if (trimmed.endsWith(";")) {
    trimmed = trimmed.substring(0, trimmed.length - 1).trim();
  }
  return trimmed;
}

/**
 * Finds which SQL statement covers the given 1-based line number.
 */
export function getStatementAtLine(statements: SqlStatement[], lineNumber: number): SqlStatement | null {
  if (statements.length === 0) return null;
  for (const stmt of statements) {
    if (lineNumber >= stmt.startLine && lineNumber <= stmt.endLine) {
      return stmt;
    }
  }
  // If cursor is past last statement or in whitespace between statements, return closest preceding or first
  let closest: SqlStatement | null = null;
  for (const stmt of statements) {
    if (stmt.startLine <= lineNumber) {
      closest = stmt;
    }
  }
  return closest || statements[0] || null;
}

export interface SqlColumnMapping {
  alias: string;
  realColumn: string;
  tableName?: string;
  isExpression: boolean;
}

/**
 * Strips quotes and brackets from identifier (e.g. `col` or "table"."col" or [col])
 */
export function cleanIdentifier(ident: string): string {
  if (!ident) return "";
  return ident
    .split(".")
    .map((part) => part.replace(/^["`\[]+|["`\]]+$/g, "").trim())
    .join(".");
}

/**
 * Extracts table name from a SQL query string (SELECT, UPDATE, INSERT, DELETE)
 */
export function extractTableFromSql(querySql: string): string | null {
  if (!querySql) return null;
  const clean = stripCommentsAndTrim(querySql);

  // Match SELECT ... FROM [schema.]table
  const fromMatch = clean.match(/\bFROM\s+(?:ONLY\s+)?([`"\[]?([a-zA-Z0-9_]+)[`"\]]?(?:\.[`"\[]?([a-zA-Z0-9_]+)[`"\]]?)?)/i);
  if (fromMatch) {
    return cleanIdentifier(fromMatch[1].trim());
  }

  // Match UPDATE [schema.]table
  const updateMatch = clean.match(/\bUPDATE\s+(?:ONLY\s+)?([`"\[]?([a-zA-Z0-9_]+)[`"\]]?(?:\.[`"\[]?([a-zA-Z0-9_]+)[`"\]]?)?)/i);
  if (updateMatch) {
    return cleanIdentifier(updateMatch[1].trim());
  }

  // Match INSERT INTO [schema.]table
  const insertMatch = clean.match(/\bINSERT\s+INTO\s+([`"\[]?([a-zA-Z0-9_]+)[`"\]]?(?:\.[`"\[]?([a-zA-Z0-9_]+)[`"\]]?)?)/i);
  if (insertMatch) {
    return cleanIdentifier(insertMatch[1].trim());
  }

  // Match DELETE FROM [schema.]table
  const deleteMatch = clean.match(/\bDELETE\s+FROM\s+(?:ONLY\s+)?([`"\[]?([a-zA-Z0-9_]+)[`"\]]?(?:\.[`"\[]?([a-zA-Z0-9_]+)[`"\]]?)?)/i);
  if (deleteMatch) {
    return cleanIdentifier(deleteMatch[1].trim());
  }

  return null;
}

/**
 * Parses the SELECT items of a SQL query and maps aliases back to their physical column names.
 */
export function extractColumnMappingsFromSql(querySql: string): Record<string, SqlColumnMapping> {
  const result: Record<string, SqlColumnMapping> = {};
  if (!querySql) return result;

  const sql = stripCommentsAndTrim(querySql);
  const len = sql.length;
  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let parenDepth = 0;

  let selectStart = -1;
  let fromStart = -1;

  // Find top-level SELECT and FROM (where parenDepth === 0)
  while (i < len) {
    const char = sql[i];
    const nextChar = i + 1 < len ? sql[i + 1] : "";

    if (inSingleQuote) {
      if (char === "'" && nextChar === "'") {
        i += 2;
        continue;
      } else if (char === "\\") {
        i += 2;
        continue;
      } else if (char === "'") {
        inSingleQuote = false;
      }
      i++;
      continue;
    }

    if (inDoubleQuote) {
      if (char === '"' && nextChar === '"') {
        i += 2;
        continue;
      } else if (char === "\\") {
        i += 2;
        continue;
      } else if (char === '"') {
        inDoubleQuote = false;
      }
      i++;
      continue;
    }

    if (inBacktick) {
      if (char === "`" && nextChar === "`") {
        i += 2;
        continue;
      } else if (char === "\\") {
        i += 2;
        continue;
      } else if (char === "`") {
        inBacktick = false;
      }
      i++;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      i++;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      i++;
      continue;
    }
    if (char === "`") {
      inBacktick = true;
      i++;
      continue;
    }

    if (char === "(") {
      parenDepth++;
      i++;
      continue;
    }
    if (char === ")") {
      if (parenDepth > 0) parenDepth--;
      i++;
      continue;
    }

    if (parenDepth === 0) {
      // Check for SELECT keyword
      if (selectStart === -1) {
        const sub = sql.substring(i);
        const match = sub.match(/^SELECT\b/i);
        if (match) {
          selectStart = i + match[0].length;
          i += match[0].length;
          continue;
        }
      } else if (fromStart === -1) {
        // Check for FROM keyword
        const sub = sql.substring(i);
        const match = sub.match(/^FROM\b/i);
        if (match) {
          fromStart = i;
          break;
        }
      }
    }

    i++;
  }

  if (selectStart === -1 || fromStart === -1 || fromStart <= selectStart) {
    return result;
  }

  let selectClause = sql.substring(selectStart, fromStart).trim();
  // Strip DISTINCT or ALL
  selectClause = selectClause.replace(/^(DISTINCT|ALL)\s+/i, "").trim();

  // Split select items by comma at paren depth 0
  const items: string[] = [];
  let itemStart = 0;
  let pDepth = 0;
  let sQuote = false;
  let dQuote = false;
  let bQuote = false;

  for (let pos = 0; pos < selectClause.length; pos++) {
    const c = selectClause[pos];
    const nc = pos + 1 < selectClause.length ? selectClause[pos + 1] : "";

    if (sQuote) {
      if (c === "'" && nc === "'") { pos++; continue; }
      if (c === "\\") { pos++; continue; }
      if (c === "'") sQuote = false;
      continue;
    }
    if (dQuote) {
      if (c === '"' && nc === '"') { pos++; continue; }
      if (c === "\\") { pos++; continue; }
      if (c === '"') dQuote = false;
      continue;
    }
    if (bQuote) {
      if (c === "`" && nc === "`") { pos++; continue; }
      if (c === "\\") { pos++; continue; }
      if (c === "`") bQuote = false;
      continue;
    }

    if (c === "'") { sQuote = true; continue; }
    if (c === '"') { dQuote = true; continue; }
    if (c === "`") { bQuote = true; continue; }

    if (c === "(") { pDepth++; continue; }
    if (c === ")") { if (pDepth > 0) pDepth--; continue; }

    if (c === "," && pDepth === 0) {
      const it = selectClause.substring(itemStart, pos).trim();
      if (it) items.push(it);
      itemStart = pos + 1;
    }
  }
  const lastItem = selectClause.substring(itemStart).trim();
  if (lastItem) items.push(lastItem);

  for (const item of items) {
    if (!item) continue;

    // Check for alias: expr AS alias OR expr alias
    let expr = item;
    let alias = "";

    // Check "expr AS alias" (case-insensitive AS keyword)
    const asMatch = item.match(/^(.*?)\s+AS\s+([`"\[]?[a-zA-Z0-9_]+[`"\]]?)$/i);
    if (asMatch) {
      expr = asMatch[1].trim();
      alias = cleanIdentifier(asMatch[2].trim());
    } else {
      // Check space-separated alias: "expr alias" where alias is a valid identifier
      const spaceMatch = item.match(/^(.*?)\s+([`"\[]?[a-zA-Z0-9_]+[`"\]]?)$/);
      if (spaceMatch && !/^(CASE|WHEN|THEN|ELSE|AND|OR|NOT|IN|IS|LIKE|BETWEEN)$/i.test(spaceMatch[2])) {
        expr = spaceMatch[1].trim();
        alias = cleanIdentifier(spaceMatch[2].trim());
      } else {
        // No explicit alias
        expr = item.trim();
        const simpleColMatch = expr.match(/^(?:([`"\[]?[a-zA-Z0-9_]+[`"\]]?)\.)?([`"\[]?[a-zA-Z0-9_]+[`"\]]?)$/);
        if (simpleColMatch) {
          alias = cleanIdentifier(simpleColMatch[2]);
        } else {
          alias = cleanIdentifier(expr);
        }
      }
    }

    if (!alias) continue;

    // Check if expr is a simple column: [table.]column
    const colMatch = expr.match(/^(?:([`"\[]?[a-zA-Z0-9_]+[`"\]]?)\.)?([`"\[]?[a-zA-Z0-9_]+[`"\]]?)$/);
    if (colMatch) {
      const tbl = colMatch[1] ? cleanIdentifier(colMatch[1]) : undefined;
      const realCol = cleanIdentifier(colMatch[2]);
      result[alias] = {
        alias,
        realColumn: realCol,
        tableName: tbl,
        isExpression: false,
      };
    } else {
      result[alias] = {
        alias,
        realColumn: alias,
        isExpression: true,
      };
    }
  }

  return result;
}

