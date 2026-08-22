export type DBType = "mariadb" | "postgres" | "sqlite";

export interface ConnectionProfile {
  id: string;
  name: string;
  type: DBType;
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  filePath?: string;
  group?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  default?: string | null;
  autoIncrement?: boolean;
  extra?: string;
}

export interface TableRowData {
  [key: string]: unknown;
}

export interface QueryExecutionResult {
  rows?: Record<string, unknown>[];
  /** Rows the statement handed back (SELECT and friends). */
  rowsReturned?: number;
  /** Rows the statement changed (INSERT/UPDATE/DELETE); null for queries. */
  affectedRows?: number | null;
  insertId?: number | string;
  fields?: string[];
  executionTimeMs?: number;
  error?: string;
}

export type FilterOperator =
  | "equals"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "neq"
  | "isNull"
  | "isNotNull";

export interface ColumnFilter {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  profileId?: string;
  profileName?: string;
  dbType?: string;
  database?: string;
  actionType: "QUERY" | "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "DDL" | "IMPORT" | "CONNECT" | "TEST" | "COMMIT" | string;
  sql?: string;
  status: "SUCCESS" | "ERROR";
  errorMessage?: string;
  executionTimeMs?: number;
  affectedRows?: number;
}

export interface AuditLogFilter {
  search?: string;
  profileId?: string;
  actionType?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

export type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL";

export interface VisualJoinInfo {
  id: string;
  joinType: JoinType;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export type VisualFilterOperator =
  | "="
  | "!="
  | ">"
  | "<"
  | ">="
  | "<="
  | "LIKE"
  | "NOT LIKE"
  | "IN"
  | "IS NULL"
  | "IS NOT NULL";

export interface VisualFilterCondition {
  id: string;
  table: string;
  column: string;
  operator: VisualFilterOperator;
  value: string;
  logic: "AND" | "OR";
}

export interface VisualSortCondition {
  id: string;
  table: string;
  column: string;
  direction: "ASC" | "DESC";
}

