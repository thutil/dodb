import { ColumnInfo, DBType } from "../../types";
import {
  ColumnDraft,
  ForeignKeyDraft,
  IndexDraft,
  OnAction,
  TableDraft,
} from "../../utils/ddlBuilder";

/**
 * Shapes returned by the `get_table_constraints` Tauri command.
 */
export interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete: string;
  onUpdate: string;
}

/** Result of the `execute_ddl` Tauri command. */
export interface DdlResult {
  success: boolean;
  executed: number;
  total?: number;
  failedIndex?: number;
  failedStatement?: string;
  error?: string;
}

export interface TableConstraints {
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  primaryKeyName?: string | null;
}

let idCounter = 0;
/** Stable key for React lists. Never reaches the SQL. */
export const makeId = (prefix: string): string => `${prefix}_${++idCounter}`;

const asOnAction = (v: string | undefined): OnAction => {
  const upper = (v || "").toUpperCase();
  switch (upper) {
    case "RESTRICT":
    case "CASCADE":
    case "SET NULL":
    case "SET DEFAULT":
      return upper;
    default:
      return "NO ACTION";
  }
};

export const newColumn = (): ColumnDraft => ({
  id: makeId("col"),
  name: "",
  type: "VARCHAR(255)",
  nullable: true,
  primaryKey: false,
  autoIncrement: false,
  defaultValue: null,
});

export const newIndex = (): IndexDraft => ({
  id: makeId("idx"),
  name: "",
  columns: [],
  unique: false,
});

export const newForeignKey = (): ForeignKeyDraft => ({
  id: makeId("fk"),
  name: "",
  columns: [],
  refTable: "",
  refColumns: [],
  onDelete: "NO ACTION",
  onUpdate: "NO ACTION",
});

/** A blank draft seeded with one sensible auto-increment primary key. */
export const emptyDraft = (dbType: DBType): TableDraft => ({
  name: "",
  columns: [
    {
      id: makeId("col"),
      name: "id",
      type: dbType === "sqlite" ? "INTEGER" : dbType === "postgres" ? "BIGINT" : "BIGINT UNSIGNED",
      nullable: false,
      primaryKey: true,
      autoIncrement: true,
      defaultValue: null,
    },
  ],
  indexes: [],
  foreignKeys: [],
});

/**
 * Build an editable draft from what the database reports. `originalName` is what
 * later lets `diffTable` tell a rename from an add/drop.
 */
export const draftFromSchema = (
  tableName: string,
  columns: ColumnInfo[],
  constraints: TableConstraints | null
): TableDraft => ({
  name: tableName,
  originalName: tableName,
  primaryKeyName: constraints?.primaryKeyName || undefined,
  columns: columns.map((c) => ({
    id: makeId("col"),
    name: c.name,
    type: c.type,
    nullable: c.nullable,
    primaryKey: c.primaryKey,
    autoIncrement: !!c.autoIncrement,
    defaultValue: c.default ?? null,
    originalName: c.name,
  })),
  indexes: (constraints?.indexes || []).map((i) => ({
    id: makeId("idx"),
    name: i.name,
    columns: [...i.columns],
    unique: !!i.unique,
    originalName: i.name,
  })),
  foreignKeys: (constraints?.foreignKeys || []).map((f) => ({
    id: makeId("fk"),
    name: f.name,
    columns: [...f.columns],
    refTable: f.refTable,
    refColumns: [...f.refColumns],
    onDelete: asOnAction(f.onDelete),
    onUpdate: asOnAction(f.onUpdate),
    originalName: f.name,
  })),
});

/** Deep copy, so edits never mutate the pristine "original" used for diffing. */
export const cloneDraft = (d: TableDraft): TableDraft => ({
  ...d,
  columns: d.columns.map((c) => ({ ...c })),
  indexes: d.indexes.map((i) => ({ ...i, columns: [...i.columns] })),
  foreignKeys: d.foreignKeys.map((f) => ({
    ...f,
    columns: [...f.columns],
    refColumns: [...f.refColumns],
  })),
});

export const TYPE_SUGGESTIONS: Record<DBType, string[]> = {
  postgres: [
    "SMALLINT", "INTEGER", "BIGINT", "NUMERIC(10,2)", "REAL", "DOUBLE PRECISION",
    "BOOLEAN", "VARCHAR(255)", "TEXT", "CHAR(1)", "UUID", "JSONB", "JSON",
    "DATE", "TIME", "TIMESTAMP", "TIMESTAMPTZ", "BYTEA", "INET",
    "GEOMETRY", "GEOMETRY(Point,4326)", "GEOMETRY(Polygon,4326)", "GEOGRAPHY", "GEOGRAPHY(Point,4326)",
  ],
  mariadb: [
    "TINYINT", "SMALLINT", "MEDIUMINT", "INT", "BIGINT", "BIGINT UNSIGNED",
    "DECIMAL(10,2)", "FLOAT", "DOUBLE", "BOOLEAN", "VARCHAR(255)", "CHAR(1)",
    "TEXT", "MEDIUMTEXT", "LONGTEXT", "JSON", "DATE", "TIME", "DATETIME",
    "TIMESTAMP", "BLOB", "ENUM('a','b')",
    "GEOMETRY", "POINT", "LINESTRING", "POLYGON", "MULTIPOINT", "MULTIPOLYGON",
  ],
  sqlite: ["INTEGER", "REAL", "TEXT", "BLOB", "NUMERIC", "BOOLEAN", "DATETIME", "GEOMETRY", "POINT", "POLYGON"],
};

/**
 * Problems that would produce SQL the database is certain to reject. Returned as
 * messages so the modal can block Apply and say why.
 */
export const validateDraft = (draft: TableDraft): string[] => {
  const errors: string[] = [];

  if (!draft.name.trim()) errors.push("Table name is required.");

  if (draft.columns.length === 0) errors.push("At least one column is required.");

  const seen = new Set<string>();
  for (const c of draft.columns) {
    const name = c.name.trim();
    if (!name) {
      errors.push("Every column needs a name.");
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) errors.push(`Duplicate column name "${name}".`);
    seen.add(key);

    if (!c.type.trim()) errors.push(`Column "${name}" needs a data type.`);
  }

  const autoCols = draft.columns.filter((c) => c.autoIncrement);
  if (autoCols.length > 1) {
    errors.push("Only one auto-increment column is allowed.");
  }
  for (const c of autoCols) {
    if (!c.primaryKey) {
      errors.push(`Auto-increment column "${c.name}" must be part of the primary key.`);
    }
  }

  for (const idx of draft.indexes) {
    if (!idx.name.trim()) errors.push("Every index needs a name.");
    if (idx.columns.length === 0) errors.push(`Index "${idx.name || "(unnamed)"}" needs at least one column.`);
  }

  for (const fk of draft.foreignKeys) {
    const label = fk.name.trim() || "(unnamed)";
    if (fk.columns.length === 0) errors.push(`Foreign key ${label} needs at least one column.`);
    if (!fk.refTable.trim()) errors.push(`Foreign key ${label} needs a referenced table.`);
    if (fk.refColumns.length !== fk.columns.length) {
      errors.push(`Foreign key ${label} must reference the same number of columns.`);
    }
  }

  return Array.from(new Set(errors));
};
