import express, { Request, Response } from "express";
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
  return {
    id: "-",
    name: "-",
    type,
    host,
    port,
    user,
    password,
    database,
    createdAt: "",
    updatedAt: "",
  };
}

// List databases
router.post("/databases", async (req: Request, res: Response) => {
  try {
    const config = getDBConfig(req);
    const pool = DBPoolManager.getPool(config);
    let sql;
    if (config.type === "mariadb") {
      sql = "SHOW DATABASES";
      const conn = await (pool as any).getConnection();
      const result = await conn.query(sql);
      await conn.release();
      res.json(result.map((row: any) => row.Database));
    } else {
      sql = "SELECT datname FROM pg_database WHERE datistemplate = false;";
      const result = await (pool as any).query(sql);
      res.json(result.rows.map((row: any) => row.datname));
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List tables
router.post("/tables", async (req: Request, res: Response) => {
  try {
    const config = getDBConfig(req);
    const { database } = req.body;
    if (!database) {
      res.status(400).json({ error: "Missing 'database' in body" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database });

    let sql;
    if (config.type === "mariadb") {
      sql = "SHOW TABLES";
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``); // เปลี่ยน DB หากจำเป็น
      const result = await conn.query(sql);
      await conn.release();
      res.json({ tables: result.map((row: any) => Object.values(row)[0]) });
    } else {
      sql = `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public';`;
      // สำหรับ PostgreSQL จะ connect ที่ database ที่ต้องการเลย
      const result = await (pool as any).query(sql);
      res.json({ tables: result.rows.map((row: any) => row.tablename) });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
