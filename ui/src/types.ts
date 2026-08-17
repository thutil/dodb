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
}

export interface TableRowData {
  [key: string]: unknown;
}

export interface QueryExecutionResult {
  rows?: Record<string, unknown>[];
  affectedRows?: number;
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
  actionType: "QUERY" | "INSERT" | "UPDATE" | "DELETE" | "DDL" | "CONNECT" | "TEST";
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

