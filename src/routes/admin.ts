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
  if (!type || !host || !port || !user) {
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
    password: decryptPassword(password || ""),
    database: database || (type === "postgres" ? "postgres" : "mysql"),
    createdAt: "",
    updatedAt: "",
  };
}

// Create Database
router.post("/create-database", (async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getDBConfig(req);
    const { name } = req.body;
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Invalid database name" });
      return;
    }
    const pool = DBPoolManager.getPool(config);
    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query(`CREATE DATABASE \`${name}\``);
      await conn.release();
    } else {
      await (pool as any).query(`CREATE DATABASE "${name}"`);
    }
    res.json({ success: true, message: `Database '${name}' created successfully` });
  } catch (err: any) {
    next(err);
  }
}) as express.RequestHandler);

// Drop Database
router.post("/drop-database", (async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getDBConfig(req);
    const { name } = req.body;
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Invalid database name" });
      return;
    }
    const pool = DBPoolManager.getPool(config);
    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query(`DROP DATABASE \`${name}\``);
      await conn.release();
    } else {
      await (pool as any).query(`DROP DATABASE "${name}"`);
    }
    res.json({ success: true, message: `Database '${name}' dropped successfully` });
  } catch (err: any) {
    next(err);
  }
}) as express.RequestHandler);

// List Users / Roles
router.post("/users", (async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getDBConfig(req);
    const pool = DBPoolManager.getPool(config);
    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      const rows = await conn.query("SELECT User as username, Host as host FROM mysql.user");
      await conn.release();
      res.json(rows.map((r: any) => ({ username: r.username, host: r.host, isSuperuser: r.username === "root" })));
    } else {
      const result = await (pool as any).query(
        "SELECT usename as username, usesuper as is_superuser, usecreatedb as can_create_db FROM pg_user ORDER BY usename"
      );
      res.json(result.rows.map((r: any) => ({ username: r.username, isSuperuser: r.is_superuser, canCreateDb: r.can_create_db })));
    }
  } catch (err: any) {
    next(err);
  }
}) as express.RequestHandler);

// Create User / Role
router.post("/create-user", (async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getDBConfig(req);
    const { username, password, isSuperuser } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: "Missing username or password" });
      return;
    }
    const pool = DBPoolManager.getPool(config);
    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query(`CREATE USER ?@'%' IDENTIFIED BY ?`, [username, password]);
      if (isSuperuser) {
        await conn.query(`GRANT ALL PRIVILEGES ON *.* TO ?@'%' WITH GRANT OPTION`, [username]);
      }
      await conn.query("FLUSH PRIVILEGES");
      await conn.release();
    } else {
      const superStr = isSuperuser ? "SUPERUSER" : "NOSUPERUSER";
      const query = `CREATE USER "${username}" WITH PASSWORD '${password}' ${superStr} CREATEDB`;
      await (pool as any).query(query);
    }
    res.json({ success: true, message: `User '${username}' created successfully` });
  } catch (err: any) {
    next(err);
  }
}) as express.RequestHandler);

// Drop User
router.post("/drop-user", (async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getDBConfig(req);
    const { username, host = "%" } = req.body;
    if (!username) {
      res.status(400).json({ error: "Missing username" });
      return;
    }
    const pool = DBPoolManager.getPool(config);
    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query(`DROP USER ?@?`, [username, host]);
      await conn.query("FLUSH PRIVILEGES");
      await conn.release();
    } else {
      await (pool as any).query(`DROP USER "${username}"`);
    }
    res.json({ success: true, message: `User '${username}' dropped successfully` });
  } catch (err: any) {
    next(err);
  }
}) as express.RequestHandler);

// List Server Running Processes
router.post("/processes", (async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getDBConfig(req);
    const pool = DBPoolManager.getPool(config);
    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      const rows = await conn.query("SHOW FULL PROCESSLIST");
      await conn.release();
      res.json(
        rows.map((r: any) => ({
          pid: r.Id,
          user: r.User,
          db: r.db,
          state: r.State || r.Command,
          query: r.Info || "",
          time: r.Time,
        }))
      );
    } else {
      const result = await (pool as any).query(
        "SELECT pid, usename as user, datname as db, state, query, age(clock_timestamp(), query_start)::text as time FROM pg_stat_activity WHERE pid <> pg_backend_pid() ORDER BY pid DESC"
      );
      res.json(
        result.rows.map((r: any) => ({
          pid: r.pid,
          user: r.user,
          db: r.db,
          state: r.state,
          query: r.query || "",
          time: r.time,
        }))
      );
    }
  } catch (err: any) {
    next(err);
  }
}) as express.RequestHandler);

// Kill Server Process
router.post("/kill-process", (async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = getDBConfig(req);
    const { pid } = req.body;
    if (!pid) {
      res.status(400).json({ error: "Missing pid parameter" });
      return;
    }
    const pool = DBPoolManager.getPool(config);
    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query(`KILL ${Number(pid)}`);
      await conn.release();
    } else {
      await (pool as any).query("SELECT pg_terminate_backend($1)", [Number(pid)]);
    }
    res.json({ success: true, message: `Process ${pid} killed successfully` });
  } catch (err: any) {
    next(err);
  }
}) as express.RequestHandler);

export default router;
