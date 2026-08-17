import express, { Request, Response, NextFunction } from "express";
import { DBConfig, DBPoolManager } from "../db/connections";
import { getProfileById } from "../config/dbProfiles";

const router = express.Router();

function getDBConfig(req: Request): DBConfig {
  const profileId = req.body.profileId || req.body.id;
  if (profileId) {
    const profile = getProfileById(profileId);
    if (profile) {
      return {
        ...profile,
        database: req.body.database || profile.database,
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
  return { id: "-", name: "-", type, host, port, user, password: password || "", database, createdAt: "", updatedAt: "" };
}

// CREATE
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
    let query, params;
    if (config.type === "mariadb") {
      query = `INSERT INTO \`${table}\` (${keys.map(k => `\`${k}\``).join(",")}) VALUES (${keys.map(() => "?").join(",")})`;
      params = values;
      const conn = await (pool as any).getConnection();
      const result = await conn.query(query, params);
      await conn.release();
      res.json({ insertId: result.insertId });
    } else {
      query = `INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`;
      params = values;
      const result = await (pool as any).query(query, params);
      res.json(result.rows[0]);
    }
  } catch (err: any) {
    next(err);
  }
}) as express.RequestHandler);

// READ
router.get("/:table/:id", (async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getDBConfig(req);
    const { table, id } = req.params;
    const pool = DBPoolManager.getPool(config);
    let query, params;
    if (config.type === "mariadb") {
      query = `SELECT * FROM \`${table}\` WHERE id = ?`;
      params = [id];
      const conn = await (pool as any).getConnection();
      const result = await conn.query(query, params);
      await conn.release();
      res.json(result[0] || null);
    } else {
      query = `SELECT * FROM "${table}" WHERE id = $1`;
      params = [id];
      const result = await (pool as any).query(query, params);
      res.json(result.rows[0] || null);
    }
  } catch (err: any) {
    next(err);
  }
}) as express.RequestHandler);

// UPDATE
router.put("/:table/:id", (async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getDBConfig(req);
    const { table, id } = req.params;
    const data = req.body.data;
    if (!data || typeof data !== "object") {
      res.status(400).json({ error: "Missing or invalid data" });
      return;
    }
    const pool = DBPoolManager.getPool(config);
    const keys = Object.keys(data);
    const values = Object.values(data);
    let query, params;
    if (config.type === "mariadb") {
      query = `UPDATE \`${table}\` SET ${keys.map(k => `\`${k}\` = ?`).join(",")} WHERE id = ?`;
      params = [...values, id];
      const conn = await (pool as any).getConnection();
      await conn.query(query, params);
      await conn.release();
      res.json({ success: true });
    } else {
      query = `UPDATE "${table}" SET ${keys.map((k, i) => `"${k}" = $${i + 1}`).join(",")} WHERE id = $${keys.length + 1} RETURNING *`;
      params = [...values, id];
      const result = await (pool as any).query(query, params);
      res.json(result.rows[0]);
    }
  } catch (err: any) {
    next(err);
  }
}) as express.RequestHandler);

// DELETE
router.delete("/:table/:id", (async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getDBConfig(req);
    const { table, id } = req.params;
    const pool = DBPoolManager.getPool(config);
    let query, params;
    if (config.type === "mariadb") {
      query = `DELETE FROM \`${table}\` WHERE id = ?`;
      params = [id];
      const conn = await (pool as any).getConnection();
      await conn.query(query, params);
      await conn.release();
      res.json({ success: true });
    } else {
      query = `DELETE FROM "${table}" WHERE id = $1 RETURNING *`;
      params = [id];
      const result = await (pool as any).query(query, params);
      res.json({ success: !!result.rowCount });
    }
  } catch (err: any) {
    next(err);
  }
}) as express.RequestHandler);

// ATOMIC TRANSACTIONAL COMMIT
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

    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      try {
        await conn.beginTransaction();
        
        // 1. Process Inserts
        for (const item of inserts) {
          const keys = Object.keys(item);
          const vals = Object.values(item);
          const sql = `INSERT INTO \`${table}\` (${keys.map(k => `\`${k}\``).join(",")}) VALUES (${keys.map(() => "?").join(",")})`;
          await conn.query(sql, vals);
        }

        // 2. Process Updates
        for (const item of updates) {
          const { pkColumn, pkValue, data } = item;
          const keys = Object.keys(data);
          const vals = Object.values(data);
          const sql = `UPDATE \`${table}\` SET ${keys.map(k => `\`${k}\` = ?`).join(",")} WHERE \`${pkColumn}\` = ?`;
          await conn.query(sql, [...vals, pkValue]);
        }

        // 3. Process Deletes
        for (const item of deletes) {
          const { pkColumn, pkValue } = item;
          const sql = `DELETE FROM \`${table}\` WHERE \`${pkColumn}\` = ?`;
          await conn.query(sql, [pkValue]);
        }

        await conn.commit();
        await conn.release();
        res.json({ success: true, message: "Transaction committed successfully" });
      } catch (txErr: any) {
        await conn.rollback();
        await conn.release();
        res.status(400).json({ success: false, error: txErr.message || "Transaction rollback executed" });
      }
    } else {
      // PostgreSQL Transaction
      const client = await (pool as any).connect();
      try {
        await client.query("BEGIN");

        // 1. Process Inserts
        for (const item of inserts) {
          const keys = Object.keys(item);
          const vals = Object.values(item);
          const sql = `INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`;
          await client.query(sql, vals);
        }

        // 2. Process Updates
        for (const item of updates) {
          const { pkColumn, pkValue, data } = item;
          const keys = Object.keys(data);
          const vals = Object.values(data);
          const sql = `UPDATE "${table}" SET ${keys.map((k, i) => `"${k}" = $${i + 1}`).join(",")} WHERE "${pkColumn}" = $${keys.length + 1}`;
          await client.query(sql, [...vals, pkValue]);
        }

        // 3. Process Deletes
        for (const item of deletes) {
          const { pkColumn, pkValue } = item;
          const sql = `DELETE FROM "${table}" WHERE "${pkColumn}" = $1`;
          await client.query(sql, [pkValue]);
        }

        await client.query("COMMIT");
        client.release();
        res.json({ success: true, message: "Transaction committed successfully" });
      } catch (txErr: any) {
        await client.query("ROLLBACK");
        client.release();
        res.status(400).json({ success: false, error: txErr.message || "Transaction rollback executed" });
      }
    }
  } catch (err: any) {
    next(err);
  }
}) as express.RequestHandler);

export default router;