#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "ralph.ts");
const result = spawnSync("bun", [scriptPath, ...process.argv.slice(2)], { stdio: "inherit" });

if (result.error) {
  console.error("Error: Bun is required to run ralph. Install Bun: https://bun.sh");
  process.exit(1);
}

process.exit(result.status ?? 1);
