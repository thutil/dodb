import express, { Request, Response, NextFunction } from "express";
import { DBConfig, DBPoolManager } from "../db/connections";
import { getProfileById } from "../config/dbProfiles";
import { decryptPassword } from "../utils/crypto";
import { addAuditLog } from "../db/auditLog";
import Database from "better-sqlite3";

const router = express.Router();

function getDBConfig(req: Request): DBConfig {
  const profileId = req.body.profileId || req.body.id;
  if (profileId) {
    const profile = getProfileById(profileId);
    if (profile) {
      const pass = (!req.body.password || req.body.password === "••••••••") ? profile.password : req.body.password;
      return {
        ...profile,
        database: req.body.database || profile.database || profile.filePath || "",
        filePath: req.body.filePath || profile.filePath,
        password: decryptPassword(pass),
      };
    }
  }
  const { type, host, port, user, password = "", database, filePath } = req.body;
  if (!type) {
    throw new Error("Missing database configuration parameter");
  }
  if (type === "sqlite") {
    const targetPath = filePath || database;
    if (!targetPath) {
      throw new Error("Missing SQLite file path");
    }
    return {
      id: "-",
      name: "-",
      type: "sqlite",
      host: "",
      port: 0,
      user: "",
      password: "",
      database: targetPath,
      filePath: targetPath,
      createdAt: "",
      updatedAt: "",
    };
  }
  if (!host || !port || !user || !database) {
    throw new Error("Missing database configuration parameter");
  }
  if (!(type === "mariadb" || type === "postgres")) {
    throw new Error("Database type must be 'mariadb', 'postgres', or 'sqlite'");
  }
  return {
    id: "-",
    name: "-",
    type,
    host,
    port,
    user,
    password: decryptPassword(password || ""),
    database,
    createdAt: "",
    updatedAt: "",
  };
}

// Execute arbitrary SQL command
router.post(
  "/",
  (async (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    let config: DBConfig;
    try {
      config = getDBConfig(req);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }

    const { sql, params } = req.body;
    if (!sql) {
      res.status(400).json({ error: "Missing SQL command" });
      return;
    }

    const pool = DBPoolManager.getPool(config);

    try {
      if (config.type === "sqlite") {
        const db = pool as Database.Database;
        const trimmedSql = sql.trim();
        const isSelect = /^(SELECT|PRAGMA|EXPLAIN|WITH)/i.test(trimmedSql);
        let result: any;
        let affectedRows = 0;

        if (isSelect) {
          result = db.prepare(sql).all(params || []);
        } else {
          const info = db.prepare(sql).run(params || []);
          affectedRows = info.changes;
          result = { affectedRows: info.changes, insertId: info.lastInsertRowid };
        }

        const duration = Date.now() - start;
        addAuditLog({
          profileId: config.id,
          profileName: config.name,
          dbType: config.type,
          database: config.database,
          actionType: isSelect ? "QUERY" : "UPDATE",
          sql,
          status: "SUCCESS",
          executionTimeMs: duration,
          affectedRows: Array.isArray(result) ? result.length : affectedRows,
        });

        res.json(result);
      } else if (config.type === "mariadb") {
        const conn = await (pool as any).getConnection();
        const result = await conn.query(sql, params || []);
        await conn.release();

        const duration = Date.now() - start;
        addAuditLog({
          profileId: config.id,
          profileName: config.name,
          dbType: config.type,
          database: config.database,
          actionType: "QUERY",
          sql,
          status: "SUCCESS",
          executionTimeMs: duration,
          affectedRows: Array.isArray(result) ? result.length : result?.affectedRows,
        });

        res.json(result);
      } else {
        const result = await (pool as any).query(sql, params || []);

        const duration = Date.now() - start;
        addAuditLog({
          profileId: config.id,
          profileName: config.name,
          dbType: config.type,
          database: config.database,
          actionType: "QUERY",
          sql,
          status: "SUCCESS",
          executionTimeMs: duration,
          affectedRows: result.rowCount || (Array.isArray(result.rows) ? result.rows.length : 0),
        });

        res.json(result.rows || result);
      }
    } catch (err: any) {
      const duration = Date.now() - start;
      addAuditLog({
        profileId: config.id,
        profileName: config.name,
        dbType: config.type,
        database: config.database,
        actionType: "QUERY",
        sql,
        status: "ERROR",
        errorMessage: err.message,
        executionTimeMs: duration,
      });

      next(err);
    }
  }) as express.RequestHandler
);

export default router;