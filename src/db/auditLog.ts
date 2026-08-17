import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import { v4 as uuidv4 } from "uuid";

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

const LOG_DB_PATH = path.join(__dirname, "../../data/logs.db");

let dbInstance: Database.Database | null = null;

function getLogDB(): Database.Database {
  if (!dbInstance) {
    const dir = path.dirname(LOG_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    dbInstance = new Database(LOG_DB_PATH);
    dbInstance.pragma("journal_mode = WAL");
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        profile_id TEXT,
        profile_name TEXT,
        db_type TEXT,
        database TEXT,
        action_type TEXT NOT NULL,
        sql TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        execution_time_ms INTEGER,
        affected_rows INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_profile ON audit_logs(profile_id);
    `);
  }
  return dbInstance;
}

export function addAuditLog(entry: Omit<AuditLogEntry, "id" | "timestamp">): AuditLogEntry {
  try {
    const db = getLogDB();
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO audit_logs (
        id, timestamp, profile_id, profile_name, db_type, database,
        action_type, sql, status, error_message, execution_time_ms, affected_rows
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      timestamp,
      entry.profileId || null,
      entry.profileName || null,
      entry.dbType || null,
      entry.database || null,
      entry.actionType,
      entry.sql || null,
      entry.status,
      entry.errorMessage || null,
      entry.executionTimeMs ?? null,
      entry.affectedRows ?? null
    );

    return { id, timestamp, ...entry };
  } catch (err) {
    console.error("Failed to add audit log:", err);
    return {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      ...entry,
    };
  }
}

export function getAuditLogs(filter: {
  search?: string;
  profileId?: string;
  actionType?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}) {
  try {
    const db = getLogDB();
    let query = "SELECT * FROM audit_logs WHERE 1=1";
    const params: any[] = [];

    if (filter.search) {
      query += " AND (sql LIKE ? OR profile_name LIKE ? OR database LIKE ? OR error_message LIKE ?)";
      const term = `%${filter.search}%`;
      params.push(term, term, term, term);
    }
    if (filter.profileId) {
      query += " AND profile_id = ?";
      params.push(filter.profileId);
    }
    if (filter.actionType) {
      query += " AND action_type = ?";
      params.push(filter.actionType);
    }
    if (filter.status) {
      query += " AND status = ?";
      params.push(filter.status);
    }
    if (filter.startDate) {
      query += " AND timestamp >= ?";
      params.push(filter.startDate);
    }
    if (filter.endDate) {
      query += " AND timestamp <= ?";
      params.push(filter.endDate);
    }

    // Count query
    const countSql = query.replace("SELECT *", "SELECT COUNT(*) as count");
    const totalRow = db.prepare(countSql).get(...params) as { count: number };

    query += " ORDER BY timestamp DESC";

    const limit = filter.limit || 100;
    const offset = filter.offset || 0;
    query += " LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = db.prepare(query).all(...params) as any[];

    const logs: AuditLogEntry[] = rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      profileId: r.profile_id,
      profileName: r.profile_name,
      dbType: r.db_type,
      database: r.database,
      actionType: r.action_type,
      sql: r.sql,
      status: r.status,
      errorMessage: r.error_message,
      executionTimeMs: r.execution_time_ms,
      affectedRows: r.affected_rows,
    }));

    return {
      logs,
      total: totalRow ? totalRow.count : 0,
      limit,
      offset,
    };
  } catch (err: any) {
    console.error("Failed to get audit logs:", err);
    return { logs: [], total: 0, limit: 100, offset: 0 };
  }
}

export function clearAuditLogs() {
  try {
    const db = getLogDB();
    db.prepare("DELETE FROM audit_logs").run();
    return true;
  } catch (err) {
    console.error("Failed to clear audit logs:", err);
    return false;
  }
}
