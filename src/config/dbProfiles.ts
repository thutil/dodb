import { ConnectionProfile } from "../models/ConnectionProfile";
import * as fs from "fs";
import * as path from "path";

const PROFILE_PATH = path.join(__dirname, "../../data/profiles.json");

function loadProfiles(): ConnectionProfile[] {
  try {
    return JSON.parse(fs.readFileSync(PROFILE_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function saveProfiles(profiles: ConnectionProfile[]) {
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profiles, null, 2));
}

function getProfileById(id: string): ConnectionProfile | undefined {
  const profiles = loadProfiles();
  return profiles.find(p => p.id === id);
}

export { loadProfiles, saveProfiles, getProfileById, PROFILE_PATH };