import express, { Request, Response, NextFunction } from "express";
import { DBConfig, DBPoolManager } from "../db/connections";
import { getProfileById } from "../config/dbProfiles";
import { decryptPassword } from "../utils/crypto";

const router = express.Router();

function getDBConfig(req: Request): DBConfig {
  const profileId = req.body.profileId || req.body.id;
  if (profileId) {
    const profile = getProfileById(profileId);
    if (profile) {
      const pass = (!req.body.password || req.body.password === "••••••••") ? profile.password : req.body.password;
      return {
        ...profile,
        database: req.body.database || profile.database,
        password: decryptPassword(pass),
      };
    }
  }
  const { type, host, port, user, password = "", database } = req.body;
  if (!type || !host || !port || !user || !database) {
    throw new Error("Missing database configuration parameter");
  }
  if (!(type === "mariadb" || type === "postgres")) {
    throw new Error("Database type must be 'mariadb' or 'postgres'");
  }
  return { id: "-", name: "-", type, host, port, user, password: decryptPassword(password || ""), database, createdAt: "", updatedAt: "" };
}

// Format table name safely for PostgreSQL and MySQL/MariaDB
function formatTableName(table: string, dbType: string): string {
  if (dbType === "postgres") {
    if (table.includes(".")) {
      const parts = table.split(".");
      return parts.map(p => `"${p.replace(/"/g, '""')}"`).join(".");
    }
    return `"${table.replace(/"/g, '""')}"`;
  } else {
    if (table.includes(".")) {
      const parts = table.split(".");
      return parts.map(p => `\`${p.replace(/`/g, '``')}\``).join(".");
    }
    return `\`${table.replace(/`/g, '``')}\``;
  }
}

// Format column name safely
function formatColumnName(col: string, dbType: string): string {
  if (dbType === "postgres") {
    return `"${col.replace(/"/g, '""')}"`;
  }
  return `\`${col.replace(/`/g, '``')}\``;
}

// ATOMIC TRANSACTIONAL COMMIT (MUST BE DEFINED BEFORE /:table PARAMETERIZED ROUTE)
router.post("/commit-changes", (async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getDBConfig(req);
    const { table, changes } = req.body;
    if (!table || !changes) {
      res.status(400).json({ error: "Missing 'table' or 'changes' parameter" });
      return;
    }
    const { inserts = [], updates = [], deletes = [] } = changes;
    const pool = DBPoolManager.getPool(config);
    const formattedTable = formatTableName(table, config.type);

    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      try {
        await conn.beginTransaction();

        // 1. Process Inserts
        for (const item of inserts) {
          const keys = Object.keys(item).filter(k => item[k] !== undefined);
          if (keys.length === 0) continue;
          const vals = keys.map(k => item[k]);
          const colsSql = keys.map(k => formatColumnName(k, "mariadb")).join(", ");
          const placeholders = keys.map(() => "?").join(", ");
          const sql = `INSERT INTO ${formattedTable} (${colsSql}) VALUES (${placeholders})`;
          await conn.query(sql, vals);
        }

        // 2. Process Updates
        for (const item of updates) {
          const pkCol = item.pkColumn || "id";
          const pkVal = item.pkValue;
          const data = item.data || {};
          const keys = Object.keys(data).filter(k => data[k] !== undefined);
          if (keys.length === 0) continue;
          const vals = keys.map(k => data[k]);
          const setSql = keys.map(k => `${formatColumnName(k, "mariadb")} = ?`).join(", ");
          const sql = `UPDATE ${formattedTable} SET ${setSql} WHERE ${formatColumnName(pkCol, "mariadb")} = ?`;
          await conn.query(sql, [...vals, pkVal]);
        }

        // 3. Process Deletes
        for (const item of deletes) {
          const pkCol = item.pkColumn || "id";
          const pkVal = item.pkValue !== undefined ? item.pkValue : item;
          const sql = `DELETE FROM ${formattedTable} WHERE ${formatColumnName(pkCol, "mariadb")} = ?`;
          await conn.query(sql, [pkVal]);
        }

        await conn.commit();
        res.json({ success: true, message: "Transaction committed successfully" });
      } catch (txErr: any) {
        await conn.rollback();
        res.status(400).json({ success: false, error: txErr.message || "Transaction rollback executed" });
      } finally {
        await conn.release();
      }
    } else {
      // PostgreSQL Transaction
      const client = await (pool as any).connect();
      try {
        await client.query("BEGIN");

        // 1. Process Inserts
        for (const item of inserts) {
          const keys = Object.keys(item).filter(k => item[k] !== undefined);
          if (keys.length === 0) continue;
          const vals = keys.map(k => item[k]);
          const colsSql = keys.map(k => formatColumnName(k, "postgres")).join(", ");
          const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
          const sql = `INSERT INTO ${formattedTable} (${colsSql}) VALUES (${placeholders})`;
          await client.query(sql, vals);
        }

        // 2. Process Updates
        for (const item of updates) {
          const pkCol = item.pkColumn || "id";
          const pkVal = item.pkValue;
          const data = item.data || {};
          const keys = Object.keys(data).filter(k => data[k] !== undefined);
          if (keys.length === 0) continue;
          const vals = keys.map(k => data[k]);
          const setSql = keys.map((k, i) => `${formatColumnName(k, "postgres")} = $${i + 1}`).join(", ");
          const sql = `UPDATE ${formattedTable} SET ${setSql} WHERE ${formatColumnName(pkCol, "postgres")} = $${keys.length + 1}`;
          await client.query(sql, [...vals, pkVal]);
        }

        // 3. Process Deletes
        for (const item of deletes) {
          const pkCol = item.pkColumn || "id";
          const pkVal = item.pkValue !== undefined ? item.pkValue : item;
          const sql = `DELETE FROM ${formattedTable} WHERE ${formatColumnName(pkCol, "postgres")} = $1`;
          await client.query(sql, [pkVal]);
        }

        await client.query("COMMIT");
        res.json({ success: true, message: "Transaction committed successfully" });
      } catch (txErr: any) {
        await client.query("ROLLBACK");
        res.status(400).json({ success: false, error: txErr.message || "Transaction rollback executed" });
      } finally {
        client.release();
      }
    }
  } catch (err: any) {
    next(err);
  }
}) as express.RequestHandler);

// SINGLE RECORD CREATE
router.post("/:table", (async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getDBConfig(req);
    const { table } = req.params;
    const data = req.body.data;
    if (!data || typeof data !== "object") {
      res.status(400).json({ error: "Missing or invalid data" });
      return;
    }
    const pool = DBPoolManager.getPool(config);
    const keys = Object.keys(data);
    const values = Object.values(data);
    const formattedTable = formatTableName(table, config.type);

    if (config.type === "mariadb") {
      const colsSql = keys.map(k => formatColumnName(k, "mariadb")).join(",");
      const query = `INSERT INTO ${formattedTable} (${colsSql}) VALUES (${keys.map(() => "?").join(",")})`;
      const conn = await (pool as any).getConnection();
      const result = await conn.query(query, values);
      await conn.release();
      res.json({ insertId: result.insertId });
    } else {
      const colsSql = keys.map(k => formatColumnName(k, "postgres")).join(",");
      const query = `INSERT INTO ${formattedTable} (${colsSql}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`;
      const result = await (pool as any).query(query, values);
      res.json(result.rows[0]);
    }
  } catch (err: any) {
    next(err);
  }
}) as express.RequestHandler);

// SINGLE RECORD READ
router.get("/:table/:id", (async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getDBConfig(req);
    const { table, id } = req.params;
    const pkCol = (req.query.pkColumn as string) || "id";
    const pool = DBPoolManager.getPool(config);
    const formattedTable = formatTableName(table, config.type);

    if (config.type === "mariadb") {
      const query = `SELECT * FROM ${formattedTable} WHERE ${formatColumnName(pkCol, "mariadb")} = ?`;
      const conn = await (pool as any).getConnection();
      const result = await conn.query(query, [id]);
      await conn.release();
      res.json(result[0] || null);
    } else {
      const query = `SELECT * FROM ${formattedTable} WHERE ${formatColumnName(pkCol, "postgres")} = $1`;
      const result = await (pool as any).query(query, [id]);
      res.json(result.rows[0] || null);
    }
  } catch (err: any) {
    next(err);
  }
}) as express.RequestHandler);

// SINGLE RECORD UPDATE
router.put("/:table/:id", (async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getDBConfig(req);
    const { table, id } = req.params;
    const pkCol = (req.body.pkColumn as string) || (req.query.pkColumn as string) || "id";
    const data = req.body.data;
    if (!data || typeof data !== "object") {
      res.status(400).json({ error: "Missing or invalid data" });
      return;
    }
    const pool = DBPoolManager.getPool(config);
    const keys = Object.keys(data);
    const values = Object.values(data);
    const formattedTable = formatTableName(table, config.type);

    if (config.type === "mariadb") {
      const setSql = keys.map(k => `${formatColumnName(k, "mariadb")} = ?`).join(",");
      const query = `UPDATE ${formattedTable} SET ${setSql} WHERE ${formatColumnName(pkCol, "mariadb")} = ?`;
      const conn = await (pool as any).getConnection();
      await conn.query(query, [...values, id]);
      await conn.release();
      res.json({ success: true });
    } else {
      const setSql = keys.map((k, i) => `${formatColumnName(k, "postgres")} = $${i + 1}`).join(",");
      const query = `UPDATE ${formattedTable} SET ${setSql} WHERE ${formatColumnName(pkCol, "postgres")} = $${keys.length + 1} RETURNING *`;
      const result = await (pool as any).query(query, [...values, id]);
      res.json(result.rows[0]);
    }
  } catch (err: any) {
    next(err);
  }
}) as express.RequestHandler);

// SINGLE RECORD DELETE
router.delete("/:table/:id", (async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getDBConfig(req);
    const { table, id } = req.params;
    const pkCol = (req.query.pkColumn as string) || "id";
    const pool = DBPoolManager.getPool(config);
    const formattedTable = formatTableName(table, config.type);

    if (config.type === "mariadb") {
      const query = `DELETE FROM ${formattedTable} WHERE ${formatColumnName(pkCol, "mariadb")} = ?`;
      const conn = await (pool as any).getConnection();
      await conn.query(query, [id]);
      await conn.release();
      res.json({ success: true });
    } else {
      const query = `DELETE FROM ${formattedTable} WHERE ${formatColumnName(pkCol, "postgres")} = $1 RETURNING *`;
      const result = await (pool as any).query(query, [id]);
      res.json({ success: !!result.rowCount });
    }
  } catch (err: any) {
    next(err);
  }
}) as express.RequestHandler);

export default router;