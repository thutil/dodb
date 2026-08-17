import { ConnectionProfile } from "../models/ConnectionProfile";
import * as fs from "fs";
import * as path from "path";
import { encryptPassword, decryptPassword } from "../utils/crypto";

const PROFILE_PATH = path.join(__dirname, "../../data/profiles.json");

function loadProfiles(): ConnectionProfile[] {
  try {
    const raw = fs.readFileSync(PROFILE_PATH, "utf-8");
    const profiles: ConnectionProfile[] = JSON.parse(raw);
    return profiles.map((p) => ({
      ...p,
      password: p.password ? decryptPassword(p.password) : "",
    }));
  } catch {
    return [];
  }
}

function saveProfiles(profiles: ConnectionProfile[]) {
  const dir = path.dirname(PROFILE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const encryptedProfiles = profiles.map((p) => ({
    ...p,
    password: p.password ? encryptPassword(p.password) : "",
  }));
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(encryptedProfiles, null, 2));
}

function getProfileById(id: string): ConnectionProfile | undefined {
  const profiles = loadProfiles();
  return profiles.find((p) => p.id === id);
}

export { loadProfiles, saveProfiles, getProfileById, PROFILE_PATH };