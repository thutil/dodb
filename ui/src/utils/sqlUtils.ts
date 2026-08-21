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
