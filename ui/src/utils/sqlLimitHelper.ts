/**
 * SQL Auto-Limit / Safe Query Mode helper
 *
 * Automatically attaches a LIMIT clause to unbounded SELECT statements
 * while leaving DDL, DML, EXPLAIN, PRAGMA, and queries that already have
 * an explicit LIMIT untouched.
 */

export interface AutoLimitResult {
  sql: string;
  wasLimited: boolean;
  appliedLimit?: number;
}

/**
 * Strips comments from SQL to inspect keywords accurately.
 */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "") // Block comments
    .replace(/--.*$/gm, "") // Line comments
    .trim();
}

/**
 * Checks if a SQL statement already has a LIMIT or FETCH FIRST clause.
 */
export function hasExistingLimit(cleanSql: string): boolean {
  // Matches:
  // - LIMIT <n>
  // - LIMIT <n> OFFSET <n>
  // - LIMIT <n>, <n>
  // - FETCH FIRST <n> ROWS ONLY
  // - FETCH NEXT <n> ROWS ONLY
  return (
    /\bLIMIT\s+\d+/i.test(cleanSql) ||
    /\bFETCH\s+(FIRST|NEXT)\s+\d+\s+ROWS?\s+ONLY/i.test(cleanSql)
  );
}

/**
 * Checks if a statement is a query that returns rows (SELECT / WITH ... SELECT).
 */
export function isSelectQuery(cleanSql: string): boolean {
  const upper = cleanSql.toUpperCase();
  if (upper.startsWith("SELECT")) return true;
  if (upper.startsWith("WITH") && /\bSELECT\b/i.test(upper)) return true;
  if (upper.startsWith("(") && /\bSELECT\b/i.test(upper)) return true;
  return false;
}

/**
 * Applies auto-limit to a single SQL statement if eligible.
 *
 * @param sql The original SQL statement.
 * @param limit The maximum number of rows (e.g. 1000). If <= 0, no limit is applied.
 */
export function applyAutoLimit(sql: string, limit: number): AutoLimitResult {
  if (!sql || limit <= 0) {
    return { sql, wasLimited: false };
  }

  const clean = stripComments(sql);
  if (!isSelectQuery(clean)) {
    return { sql, wasLimited: false };
  }

  if (hasExistingLimit(clean)) {
    return { sql, wasLimited: false };
  }

  // Remove trailing semicolons and trailing whitespace from the original SQL
  const trimmed = sql.trim().replace(/;+\s*$/, "");

  // Append LIMIT clause with clean semicolon
  const modifiedSql = `${trimmed} LIMIT ${limit};`;

  return {
    sql: modifiedSql,
    wasLimited: true,
    appliedLimit: limit,
  };
}
