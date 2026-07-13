import { readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOTS = ["src", "test", "scripts", "vite.config.js", "playwright.config.js"];
const SOURCE_EXTENSIONS = new Set([".js", ".mjs"]);

async function collectSourceFiles(entry) {
  let metadata;

  try {
    metadata = await stat(entry);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  if (metadata.isFile()) {
    return SOURCE_EXTENSIONS.has(path.extname(entry)) ? [entry] : [];
  }

  const children = await readdir(entry, { withFileTypes: true });
  const nested = await Promise.all(
    children
      .filter((child) => child.name !== "node_modules" && child.name !== "dist")
      .map((child) => collectSourceFiles(path.join(entry, child.name))),
  );

  return nested.flat();
}

const sourceFiles = (await Promise.all(ROOTS.map(collectSourceFiles)))
  .flat()
  .sort();

if (sourceFiles.length === 0) {
  throw new Error("No JavaScript source files were found.");
}

const failures = [];

for (const file of sourceFiles) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    failures.push({ file, output: result.stderr || result.stdout });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\nSyntax check failed: ${failure.file}\n${failure.output}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Syntax check passed for ${sourceFiles.length} JavaScript files.`);
}
