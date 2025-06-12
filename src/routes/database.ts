import express, { Request, Response, NextFunction } from "express";
import { DBConfig, DBPoolManager } from "../db/connections";
import { getProfileById } from "../config/dbProfiles";

const router = express.Router();

function getDBConfig(req: Request): DBConfig {
  const { profileId } = req.body;
  if (profileId) {
    const profile = getProfileById(profileId);
    if (!profile) throw new Error("Profile not found");
    return profile;
  }
  const { type, host, port, user, password, database } = req.body;
  if (!type || !host || !port || !user || !password || !database) {
    throw new Error("Missing database configuration parameter");
  }
  if (!(type === "mariadb" || type === "postgres")) {
    throw new Error("Database type must be 'mariadb' or 'postgres'");
  }
  return { id: "-", name: "-", type, host, port, user, password, database, createdAt: "", updatedAt: "" };
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

export default router;