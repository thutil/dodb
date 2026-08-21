const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Dynamically resolves application version with priority:
 * 1. CI / GitHub Actions environment variables (GITHUB_REF_NAME / GITHUB_REF / NEXT_PUBLIC_APP_VERSION)
 * 2. Exact Git tag match (git describe --tags --exact-match)
 * 3. Root package.json version
 * 4. Tauri config version (src-tauri/tauri.conf.json)
 * 5. UI package.json version
 */
function resolveAppVersion() {
  // 1. Explicit env variable
  if (process.env.NEXT_PUBLIC_APP_VERSION) {
    return process.env.NEXT_PUBLIC_APP_VERSION.replace(/^v/, "").trim();
  }

  // 2. GitHub Actions Tag Name (e.g. GITHUB_REF_NAME="v0.1.1" when triggered on tag push)
  if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_TYPE === "tag") {
    return process.env.GITHUB_REF_NAME.replace(/^v/, "").trim();
  }

  // 3. GitHub Actions Ref (e.g. GITHUB_REF="refs/tags/v0.1.1")
  if (process.env.GITHUB_REF && process.env.GITHUB_REF.startsWith("refs/tags/")) {
    return process.env.GITHUB_REF.replace(/^refs\/tags\//, "").replace(/^v/, "").trim();
  }

  // 4. Check exact git tag if git repository is available
  try {
    const exactTag = execSync("git describe --tags --exact-match 2>/dev/null", { encoding: "utf8" }).trim();
    if (exactTag) {
      return exactTag.replace(/^v/, "").trim();
    }
  } catch (e) {
    // Not an exact tagged commit
  }

  // 5. Read from root package.json
  try {
    const rootPkgPath = path.resolve(__dirname, "../package.json");
    if (fs.existsSync(rootPkgPath)) {
      const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
      if (rootPkg.version) return rootPkg.version.trim();
    }
  } catch (e) {}

  // 6. Read from src-tauri/tauri.conf.json
  try {
    const tauriConfPath = path.resolve(__dirname, "../src-tauri/tauri.conf.json");
    if (fs.existsSync(tauriConfPath)) {
      const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
      if (tauriConf.version) return tauriConf.version.trim();
    }
  } catch (e) {}

  // 7. Read from ui/package.json
  try {
    const uiPkg = require("./package.json");
    if (uiPkg.version) return uiPkg.version.trim();
  } catch (e) {}

  return "0.1.0";
}

const appVersion = resolveAppVersion();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  devIndicators: false,
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
};

module.exports = nextConfig;
