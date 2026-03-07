#!/usr/bin/env bun

console.log("fixture agent ready");

const shutdown = () => {
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await new Promise(() => {});
