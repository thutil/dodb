import * as fs from "fs";
import * as path from "path";

export interface AppSettings {
  guiWidth: number;
  guiHeight: number;
  disableDevTools: boolean;
}

const SETTINGS_PATH = path.join(__dirname, "../../data/settings.json");

const defaultSettings: AppSettings = {
  guiWidth: 1280,
  guiHeight: 850,
  disableDevTools: true,
};

export function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
      return { ...defaultSettings, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.error("Failed to load settings:", err);
  }
  return defaultSettings;
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
  try {
    const current = loadSettings();
    const updated = { ...current, ...settings };
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2));
    return updated;
  } catch (err) {
    console.error("Failed to save settings:", err);
    return loadSettings();
  }
}
