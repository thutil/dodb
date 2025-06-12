import { Request, Response } from "express";
import { ConnectionProfile } from "../models/ConnectionProfile";
import { loadProfiles, saveProfiles, PROFILE_PATH } from "../config/dbProfiles";
import { v4 as uuidv4 } from "uuid";

// List
export function listProfiles(req: Request, res: Response) {
  res.json(loadProfiles());
}

// Create
export function createProfile(req: Request, res: Response) {
  const profiles = loadProfiles();
  const now = new Date().toISOString();
  const profile: ConnectionProfile = {
    ...req.body,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
  };
  profiles.push(profile);
  saveProfiles(profiles);
  res.status(201).json(profile);
}

// Update
export function updateProfile(req: Request, res: Response) {
  const { id } = req.params;
  const profiles = loadProfiles();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  profiles[idx] = {
    ...profiles[idx],
    ...req.body,
    updatedAt: new Date().toISOString(),
  };
  saveProfiles(profiles);
  res.json(profiles[idx]);
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
