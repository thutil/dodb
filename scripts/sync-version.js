#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function getTargetVersion() {
  if (process.argv[2]) {
    return process.argv[2].replace(/^v/, "").trim();
  }
  if (process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME.replace(/^v/, "").trim();
  }
  if (
    process.env.GITHUB_REF &&
    process.env.GITHUB_REF.startsWith("refs/tags/")
  ) {
    return process.env.GITHUB_REF.replace(/^refs\/tags\//, "")
      .replace(/^v/, "")
      .trim();
  }
  try {
    const gitTag = execSync("git describe --tags --exact-match 2>/dev/null", {
      encoding: "utf8",
    }).trim();
    if (gitTag) return gitTag.replace(/^v/, "").trim();
  } catch {}
  const rootPkgPath = path.resolve(__dirname, "../package.json");
  if (fs.existsSync(rootPkgPath)) {
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
    if (rootPkg.version) return rootPkg.version;
  }
  return "0.2.4";
}

const version = getTargetVersion();
if (!version) {
  console.error("Error: Could not determine target version.");
  process.exit(1);
}

console.log(`🚀 Synchronizing project version to: ${version}`);

const rootPkgPath = path.resolve(__dirname, "../package.json");
if (fs.existsSync(rootPkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
  pkg.version = version;
  fs.writeFileSync(rootPkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  ✓ Updated package.json -> ${version}`);
}

const uiPkgPath = path.resolve(__dirname, "../ui/package.json");
if (fs.existsSync(uiPkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(uiPkgPath, "utf8"));
  pkg.version = version;
  fs.writeFileSync(uiPkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  ✓ Updated ui/package.json -> ${version}`);
}

const tauriConfPath = path.resolve(__dirname, "../src-tauri/tauri.conf.json");
if (fs.existsSync(tauriConfPath)) {
  const conf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
  conf.version = version;
  fs.writeFileSync(tauriConfPath, JSON.stringify(conf, null, 2) + "\n");
  console.log(`  ✓ Updated src-tauri/tauri.conf.json -> ${version}`);
}

const cargoTomlPath = path.resolve(__dirname, "../src-tauri/Cargo.toml");
if (fs.existsSync(cargoTomlPath)) {
  let content = fs.readFileSync(cargoTomlPath, "utf8");
  content = content.replace(
    /(^\[package\][\s\S]*?\nversion\s*=\s*)"[^"]+"/m,
    `$1"${version}"`,
  );
  fs.writeFileSync(cargoTomlPath, content);
  console.log(`  ✓ Updated src-tauri/Cargo.toml -> ${version}`);
}

console.log(`✨ Version synchronization completed for ${version}!\n`);
