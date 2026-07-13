import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const EXPECTED_VERSIONS = Object.freeze({
  "@cesium/engine": "19.0.0",
  "@cesium/widgets": "13.0.0",
  "@zip.js/zip.js": "2.7.70",
  cesium: "1.132.0",
  vite: "6.0.0",
  "vite-plugin-static-copy": "2.3.2",
});

async function readInstalledPackage(packageName) {
  let directory = dirname(require.resolve(packageName));

  while (true) {
    const packagePath = join(directory, "package.json");

    try {
      const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
      if (packageJson.name === packageName) return packageJson;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Could not locate package.json for ${packageName}.`);
    }
    directory = parent;
  }
}

const mismatches = [];

for (const [packageName, expectedVersion] of Object.entries(EXPECTED_VERSIONS)) {
  const installedPackage = await readInstalledPackage(packageName);

  if (installedPackage.version !== expectedVersion) {
    mismatches.push({
      packageName,
      expectedVersion,
      installedVersion: installedPackage.version,
    });
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
