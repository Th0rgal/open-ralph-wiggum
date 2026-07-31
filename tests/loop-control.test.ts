import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  LoopControlError,
  startLoopControl,
  steerCurrentIteration,
} from "../loop-control";

const runtimeDirs: string[] = [];

afterEach(() => {
  delete process.env.RALPH_CONTROL_DIR;
  for (const dir of runtimeDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function useIsolatedRuntime(): string {
  const runtimeDir = mkdtempSync(join(tmpdir(), "ralph-control-test."));
  runtimeDirs.push(runtimeDir);
  process.env.RALPH_CONTROL_DIR = runtimeDir;
  return runtimeDir;
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for control fixture");
}

describe("LoopControl", () => {
  it("routes steering to the active workspace generation", async () => {
    useIsolatedRuntime();
    const workspace = mkdtempSync(join(tmpdir(), "ralph-control-workspace."));
    runtimeDirs.push(workspace);
    const control = await startLoopControl(workspace);
    let received = "";

    try {
      const deactivate = control.activate("pi", async text => {
        received = text;
      });

      await steerCurrentIteration(workspace, "Focus on the failing test");
      expect(received).toBe("Focus on the failing test");

      deactivate();
      await expect(steerCurrentIteration(workspace, "Too late")).rejects.toMatchObject({
        code: "no-active-iteration",
      });
    } finally {
      await control.close();
    }
  });

  it("waits beyond the request framing deadline for a safe turn boundary", async () => {
    useIsolatedRuntime();
    const workspace = mkdtempSync(join(tmpdir(), "ralph-control-long-tool."));
    runtimeDirs.push(workspace);
    const control = await startLoopControl(workspace);

    try {
      control.activate("pi", async () => {
        await new Promise(resolve => setTimeout(resolve, 2_200));
      });
      const startedAt = Date.now();
      await steerCurrentIteration(workspace, "Wait for the long tool");
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(2_100);
    } finally {
      await control.close();
    }
  });

  it("does not let an old lease deactivate a newer generation", async () => {
    useIsolatedRuntime();
    const workspace = mkdtempSync(join(tmpdir(), "ralph-control-generation."));
    runtimeDirs.push(workspace);
    const control = await startLoopControl(workspace);
    let deliveredTo = "";

    try {
      const releaseOld = control.activate("pi", async () => { deliveredTo = "old"; });
      control.activate("pi", async () => { deliveredTo = "new"; });
      releaseOld();

      await steerCurrentIteration(workspace, "Use the current generation");
      expect(deliveredTo).toBe("new");
    } finally {
      await control.close();
    }
  });

  it("reports unsupported agents without falling back to context", async () => {
    useIsolatedRuntime();
    const workspace = mkdtempSync(join(tmpdir(), "ralph-control-unsupported."));
    runtimeDirs.push(workspace);
    const control = await startLoopControl(workspace);

    try {
      control.activate("codex");
      const error = await steerCurrentIteration(workspace, "Do this now").catch(value => value);
      expect(error).toBeInstanceOf(LoopControlError);
      expect(error).toMatchObject({ code: "unsupported-agent" });
      expect(error.message).toContain("codex");
      expect(error.message).toContain("--add-context");
    } finally {
      await control.close();
    }
  });

  it("rejects oversized steering before discovery", async () => {
    useIsolatedRuntime();
    const workspace = mkdtempSync(join(tmpdir(), "ralph-control-size."));
    runtimeDirs.push(workspace);

    await expect(steerCurrentIteration(workspace, "x".repeat(64 * 1024 + 1))).rejects.toMatchObject({
      code: "message-too-large",
    });
  });

  it("accepts escaped JSON text within the steering byte limit", async () => {
    useIsolatedRuntime();
    const workspace = mkdtempSync(join(tmpdir(), "ralph-control-escaped-size."));
    runtimeDirs.push(workspace);
    const control = await startLoopControl(workspace);
    const text = "\\".repeat(40_000);
    let received = "";

    try {
      control.activate("pi", async value => { received = value; });
      await steerCurrentIteration(workspace, text);
      expect(received).toBe(text);
    } finally {
      await control.close();
    }
  });

  it("removes stale descriptor and socket artifacts after a crashed loop", async () => {
    const runtimeDir = useIsolatedRuntime();
    const workspace = mkdtempSync(join(tmpdir(), "ralph-control-stale."));
    runtimeDirs.push(workspace);
    const fixture = join(workspace, "control-fixture.ts");
    const ready = join(workspace, "ready");
    const modulePath = join(import.meta.dir, "..", "loop-control.ts");
    writeFileSync(fixture, `
import { startLoopControl } from ${JSON.stringify(modulePath)};
import { writeFileSync } from "fs";
const control = await startLoopControl(${JSON.stringify(workspace)});
control.activate("pi", async () => {});
writeFileSync(${JSON.stringify(ready)}, "ready");
await new Promise(() => {});
`);

    const child = Bun.spawn({
      cmd: ["bun", fixture],
      env: { ...process.env, RALPH_CONTROL_DIR: runtimeDir },
      stdout: "ignore",
      stderr: "ignore",
    });

    try {
      await waitFor(() => existsSync(ready));
      const descriptorName = readdirSync(runtimeDir).find(name => name.endsWith(".json"));
      expect(descriptorName).toBeDefined();
      const descriptorPath = join(runtimeDir, descriptorName!);
      const endpoint = JSON.parse(readFileSync(descriptorPath, "utf-8")).endpoint as string;

      child.kill("SIGKILL");
      await child.exited;
      expect(existsSync(descriptorPath)).toBe(true);

      await expect(steerCurrentIteration(workspace, "Cannot be delivered")).rejects.toMatchObject({
        code: "no-active-loop",
      });
      expect(readdirSync(runtimeDir)).toEqual([]);
      if (process.platform !== "win32") expect(existsSync(endpoint)).toBe(false);
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
    }
  });

  it("fails closed when multiple loops own the same workspace", async () => {
    useIsolatedRuntime();
    const workspace = mkdtempSync(join(tmpdir(), "ralph-control-ambiguous."));
    runtimeDirs.push(workspace);
    const first = await startLoopControl(workspace);
    const second = await startLoopControl(workspace);
    let deliveries = 0;

    try {
      first.activate("pi", async () => { deliveries++; });
      second.activate("pi", async () => { deliveries++; });

      await expect(steerCurrentIteration(workspace, "Do not guess")).rejects.toMatchObject({
        code: "ambiguous-loop",
      });
      expect(deliveries).toBe(0);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
});
