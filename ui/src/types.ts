export type DBType = "mariadb" | "postgres";

export interface ConnectionProfile {
  id: string;
  name: string;
  type: DBType;
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
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
