import { Request, Response } from "express";
import { ConnectionProfile } from "../models/ConnectionProfile";
import { loadProfiles, saveProfiles, getProfileById } from "../config/dbProfiles";
import { decryptPassword } from "../utils/crypto";
import { addAuditLog } from "../db/auditLog";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";

// List (Mask passwords so plaintext is never exposed to frontend)
export function listProfiles(req: Request, res: Response) {
  const profiles = loadProfiles();
  const safeProfiles = profiles.map((p) => ({
    ...p,
    password: p.password ? "••••••••" : "",
  }));
  res.json(safeProfiles);
}

// Create
export function createProfile(req: Request, res: Response) {
  const profiles = loadProfiles();
  const now = new Date().toISOString();
  const rawPassword = req.body.password || "";
  const profile: ConnectionProfile = {
    ...req.body,
    group: req.body.group || "Default",
    password: rawPassword,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
  };
  profiles.push(profile);
  saveProfiles(profiles);
  res.status(201).json({
    ...profile,
    password: profile.password ? "••••••••" : "",
  });
}

// Update
export function updateProfile(req: Request, res: Response) {
  const { id } = req.params;
  const profiles = loadProfiles();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  let newPassword = req.body.password;
  if (!newPassword || newPassword === "••••••••") {
    newPassword = profiles[idx].password;
  }

  profiles[idx] = {
    ...profiles[idx],
    ...req.body,
    group: req.body.group !== undefined ? req.body.group : profiles[idx].group || "Default",
    password: newPassword,
    updatedAt: new Date().toISOString(),
  };
  saveProfiles(profiles);
  res.json({
    ...profiles[idx],
    password: profiles[idx].password ? "••••••••" : "",
  });
}

// Delete
export function deleteProfile(req: Request, res: Response) {
  const { id } = req.params;
  let profiles = loadProfiles();
  const found = profiles.find((p) => p.id === id);
  if (!found) return res.status(404).json({ error: "Not found" });
  profiles = profiles.filter((p) => p.id !== id);
  saveProfiles(profiles);
  res.status(204).end();
}

// Test Connection
export async function testProfile(req: Request, res: Response) {
  const start = Date.now();
  let config = { ...req.body };
  try {
    const { DBPoolManager } = require("../db/connections");
    if (config.id) {
      const p = getProfileById(config.id);
      if (p) {
        if (!config.password || config.password === "••••••••") {
          config.password = p.password;
        }
        config = { ...p, ...config, password: config.password || p.password };
      }
    }
    if (config.password && config.password.startsWith("enc:")) {
      config.password = decryptPassword(config.password);
    }
    const pool = DBPoolManager.getPool(config);
    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query("SELECT 1");
      await conn.release();
    } else if (config.type === "postgres") {
      await (pool as any).query("SELECT 1");
    } else if (config.type === "sqlite") {
      const dbPath = config.filePath || config.database;
      if (dbPath !== ":memory:" && !fs.existsSync(dbPath)) {
        throw new Error(`SQLite database file not found at: ${dbPath}`);
      }
      (pool as any).prepare("SELECT 1").get();
    }

    const duration = Date.now() - start;
    addAuditLog({
      profileId: config.id,
      profileName: config.name,
      dbType: config.type,
      database: config.database || config.filePath,
      actionType: "TEST",
      sql: "SELECT 1",
      status: "SUCCESS",
      executionTimeMs: duration,
    });

    res.json({ success: true, message: "Connection successful" });
  } catch (err: any) {
    const duration = Date.now() - start;
    addAuditLog({
      profileId: config.id,
      profileName: config.name,
      dbType: config.type,
      database: config.database || config.filePath,
      actionType: "TEST",
      sql: "SELECT 1",
      status: "ERROR",
      errorMessage: err.message || "Failed to connect",
      executionTimeMs: duration,
    });
    res.status(400).json({ success: false, error: err.message || "Failed to connect" });
  }
}
