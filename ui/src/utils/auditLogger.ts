import { AuditLogEntry } from "../types";

const STORAGE_KEY = "dodb_audit_logs_v1";
const MAX_LOGS = 500;

export const auditLogger = {
  getLogs(): AuditLogEntry[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  addLog(entry: Omit<AuditLogEntry, "id" | "timestamp">): AuditLogEntry {
    const fullEntry: AuditLogEntry = {
      ...entry,
      id: "log_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      timestamp: new Date().toISOString(),
    };

    if (typeof window !== "undefined") {
      try {
        const current = this.getLogs();
        const updated = [fullEntry, ...current].slice(0, MAX_LOGS);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error("Failed to save audit log", err);
      }
    }

    return fullEntry;
  },

  clearLogs(): void {
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (err) {
        console.error("Failed to clear audit logs", err);
      }
    }
  },
};
