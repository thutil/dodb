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

// Execute arbitrary SQL command (DANGER: validate input in real use)
router.post(
  "/",
  (async (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = getDBConfig(req);
      const { sql, params } = req.body;
      if (!sql) {
        res.status(400).json({ error: "Missing SQL command" });
        return;
      }
      const pool = DBPoolManager.getPool(config);
      if (config.type === "mariadb") {
        const conn = await (pool as any).getConnection();
        const result = await conn.query(sql, params || []);
        await conn.release();
        res.json(result);
      } else {
        const result = await (pool as any).query(sql, params || []);
        res.json(result.rows || result);
      }
    } catch (err: any) {
      next(err);
    }
  }) as express.RequestHandler
);

export default router;