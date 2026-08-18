import { ConnectionProfile } from "../models/ConnectionProfile";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { encryptPassword, decryptPassword } from "../utils/crypto";

function getDataDirectory(): string {
  if (process.env.DODB_DATA_DIR) {
    return process.env.DODB_DATA_DIR;
  }
  return path.join(os.homedir(), ".dodb");
}

const DATA_DIR = getDataDirectory();
const PROFILE_PATH = path.join(DATA_DIR, "profiles.json");

function migrateLegacyProfiles() {
  try {
    if (fs.existsSync(PROFILE_PATH)) return;

    // Check potential legacy paths
    const legacyPaths = [
      path.join(__dirname, "../../data/profiles.json"),
      path.join(process.cwd(), "data/profiles.json"),
    ];

    for (const legacyPath of legacyPaths) {
      if (fs.existsSync(legacyPath)) {
        console.log(`Migrating legacy profile database from ${legacyPath} to ${PROFILE_PATH}`);
        if (!fs.existsSync(DATA_DIR)) {
          fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
        }
        const raw = fs.readFileSync(legacyPath, "utf-8");
        const parsed: ConnectionProfile[] = JSON.parse(raw);
        // Ensure all passwords in migrated file are encrypted AES-256-GCM
        const encrypted = parsed.map((p) => ({
          ...p,
          password: p.password ? encryptPassword(decryptPassword(p.password)) : "",
        }));
        fs.writeFileSync(PROFILE_PATH, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
        console.log("Profile migration completed successfully with AES-256-GCM encryption.");
        break;
      }
    }
  } catch (err) {
    console.error("Migration error:", err);
  }
}

function loadProfiles(): ConnectionProfile[] {
  migrateLegacyProfiles();
  try {
    if (!fs.existsSync(PROFILE_PATH)) return [];
    const raw = fs.readFileSync(PROFILE_PATH, "utf-8");
    const profiles: ConnectionProfile[] = JSON.parse(raw);
    return profiles.map((p) => ({
      ...p,
      password: p.password ? decryptPassword(p.password) : "",
    }));
  } catch (err) {
    console.error("Failed to load profiles:", err);
    return [];
  }
}

function saveProfiles(profiles: ConnectionProfile[]) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
  const encryptedProfiles = profiles.map((p) => ({
    ...p,
    password: p.password ? encryptPassword(p.password) : "",
  }));
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(encryptedProfiles, null, 2), { mode: 0o600 });
}

function getProfileById(id: string): ConnectionProfile | undefined {
  const profiles = loadProfiles();
  return profiles.find((p) => p.id === id);
}

export { loadProfiles, saveProfiles, getProfileById, PROFILE_PATH, DATA_DIR };