import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const EXPECTED_VERSIONS = Object.freeze({
  "@cesium/engine": "19.0.0",
  "@cesium/widgets": "13.0.0",
  "@zip.js/zip.js": "2.7.70",
  cesium: "1.132.0",
  vite: "6.0.0",
  "vite-plugin-static-copy": "2.3.2",
});

async function readInstalledVersion(packageName) {
  const packagePath = require.resolve(`${packageName}/package.json`);
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  return packageJson.version;
}

const mismatches = [];

for (const [packageName, expectedVersion] of Object.entries(EXPECTED_VERSIONS)) {
  const installedVersion = await readInstalledVersion(packageName);

  if (installedVersion !== expectedVersion) {
    mismatches.push({ packageName, expectedVersion, installedVersion });
  }
}

if (mismatches.length > 0) {
  for (const mismatch of mismatches) {
    console.error(
      `${mismatch.packageName}: expected ${mismatch.expectedVersion}, installed ${mismatch.installedVersion}`,
    );
  }
  process.exit(1);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const dependencyTree = spawnSync(
  npmCommand,
  [
    "ls",
    "@cesium/engine",
    "@cesium/widgets",
    "@zip.js/zip.js",
    "cesium",
    "--all",
  ],
  { encoding: "utf8" },
);

if (dependencyTree.status !== 0) {
  console.error(dependencyTree.stdout);
  console.error(dependencyTree.stderr);
  process.exit(1);
}

await import("@zip.js/zip.js/lib/zip-no-worker.js");
await import("cesium");

console.log("Dependency versions, dependency tree, and Cesium imports are valid.");
