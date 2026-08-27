#!/usr/bin/env node
/**
 * Writes one version into every place that carries it.
 *
 * There is no Cargo.toml or tauri.conf.json any more: the Go build takes its
 * version from an -ldflags stamp, so package.json is the single source and this
 * script's job shrank to keeping the two manifests and the Homebrew cask in
 * step with a release tag.
 *
 * Usage:
 *   node scripts/sync-version.js 0.3.0
 *   node scripts/sync-version.js            # infer from the tag, then git, then package.json
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

/** Strips a leading v and surrounding whitespace. */
const clean = (v) => String(v).replace(/^v/, "").trim();

function getTargetVersion() {
  if (process.argv[2]) return clean(process.argv[2]);
  if (process.env.GITHUB_REF_NAME) return clean(process.env.GITHUB_REF_NAME);
  if (process.env.GITHUB_REF?.startsWith("refs/tags/")) {
    return clean(process.env.GITHUB_REF.replace(/^refs\/tags\//, ""));
  }
  try {
    const tag = execSync("git describe --tags --exact-match", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (tag) return clean(tag);
  } catch {
    // Not on a tag; fall through to the manifest.
  }
  // package.json last, and with no hardcoded fallback beneath it: the previous
  // version of this script fell back to a literal "0.2.4", which silently
  // mislabelled every non-tag build once the real version moved past it.
  const pkg = readJson(path.join(ROOT, "package.json"));
  if (pkg?.version) return clean(pkg.version);
  return null;
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

const version = getTargetVersion();
if (!version) {
  console.error(
    "could not determine a version: pass one as an argument, tag the commit, " +
      "or set a version in package.json",
  );
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+/.test(version)) {
  // Caught here rather than at build time: the version ends up in the DMG's
  // filename, which Casks/dodb.rb and the release workflow both hardcode.
  console.error(`"${version}" is not a semver version (expected e.g. 0.3.0)`);
  process.exit(1);
}

console.log(`syncing project version to ${version}`);

let touched = 0;

for (const rel of ["package.json", "ui/package.json"]) {
  const file = path.join(ROOT, rel);
  const pkg = readJson(file);
  if (!pkg) continue;
  if (pkg.version === version) {
    console.log(`  = ${rel} already ${version}`);
    continue;
  }
  pkg.version = version;
  writeJson(file, pkg);
  console.log(`  ✓ ${rel} -> ${version}`);
  touched++;
}

/**
 * The cask names the DMG and its checksum. The release workflow rewrites this
 * file from the real artifact anyway, so the sha256 is only reset to a
 * placeholder here -- writing a stale checksum would be worse than an obviously
 * missing one.
 */
const caskPath = path.join(ROOT, "Casks", "dodb.rb");
if (fs.existsSync(caskPath)) {
  let cask = fs.readFileSync(caskPath, "utf8");
  const before = cask;
  cask = cask.replace(/^(\s*version\s+)"[^"]+"/m, `$1"${version}"`);
  if (cask !== before) {
    fs.writeFileSync(caskPath, cask);
    console.log(`  ✓ Casks/dodb.rb -> ${version}`);
    touched++;
  } else {
    console.log(`  = Casks/dodb.rb already ${version}`);
  }
}

console.log(
  touched === 0
    ? `nothing to change; everything already reports ${version}`
    : `done (${touched} file${touched === 1 ? "" : "s"} updated)`,
);
console.log(
  "\nnote: the Go binary takes its version from -ldflags at build time " +
    "(see scripts/build-macos.sh), so there is nothing to sync there.",
);
