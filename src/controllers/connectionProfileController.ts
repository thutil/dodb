import { Request, Response } from "express";
import { ConnectionProfile } from "../models/ConnectionProfile";
import { loadProfiles, saveProfiles, getProfileById } from "../config/dbProfiles";
import { decryptPassword } from "../utils/crypto";
import { v4 as uuidv4 } from "uuid";

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
  try {
    const { DBPoolManager } = require("../db/connections");
    let config = { ...req.body };
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
    } else {
      await (pool as any).query("SELECT 1");
    }
    res.json({ success: true, message: "Connection successful" });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || "Failed to connect" });
  }
}

