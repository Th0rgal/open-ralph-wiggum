import { describe, expect, it } from "bun:test";
import {
  StreamActivityTracker,
  decideLoopOwnership,
  pruneExpiredBlacklistedAgents,
  selectRotationEntry,
} from "../loop-runtime";

describe("loop-runtime", () => {
  describe("decideLoopOwnership", () => {
    it("blocks when another live process owns the active loop", () => {
      const decision = decideLoopOwnership({ active: true, pid: process.pid }, process.pid + 1);
      expect(decision).toEqual({ status: "already-running", ownerPid: process.pid });
    });

    it("allows resuming when the state belongs to the current process", () => {
      const decision = decideLoopOwnership({ active: true, pid: process.pid }, process.pid);
      expect(decision).toEqual({ status: "resume", ownerPid: process.pid });
    });

    it("treats dead owner pids as resumable state", () => {
      const decision = decideLoopOwnership({ active: true, pid: 999999 }, process.pid);
      expect(decision).toEqual({ status: "resume", ownerPid: 999999 });
    });
  });

  describe("StreamActivityTracker", () => {
    it("updates activity time for partial chunks without waiting for a newline", () => {
      let now = 1000;
      const tracker = new StreamActivityTracker(() => now);

      now = 1400;
      tracker.markChunk("partial");
      expect(tracker.lastActivityAt).toBe(1400);

      now = 1800;
      tracker.markLine();
      expect(tracker.lastActivityAt).toBe(1800);
    });
  });

  describe("rotation fallback", () => {
    it("prunes expired blacklisted agents", () => {
      const { active, expiredAgents } = pruneExpiredBlacklistedAgents(
        [
          {
            agent: "opencode",
            blacklistedAt: "2026-03-15T00:00:00.000Z",
            durationMs: 1_000,
          },
          {
            agent: "codex",
            blacklistedAt: "2026-03-15T00:00:01.000Z",
            durationMs: 10_000,
          },
        ],
        new Date("2026-03-15T00:00:05.000Z").getTime(),
      );

      expect(expiredAgents).toEqual(["opencode"]);
      expect(active.map((entry) => entry.agent)).toEqual(["codex"]);
    });

    it("skips blacklisted agents and picks the next available rotation entry", () => {
      const decision = selectRotationEntry(
        ["opencode:model-a", "codex:model-b", "copilot:model-c"],
        0,
        [{ agent: "opencode", blacklistedAt: "2026-03-15T00:00:00.000Z", durationMs: 60_000 }],
      );

      expect(decision).toMatchObject({
        entry: "codex:model-b",
        rotationIndex: 1,
        skippedAgents: ["opencode"],
        clearedBlacklist: false,
      });
    });

    it("clears the blacklist fallback when every rotation entry is blacklisted", () => {
      const decision = selectRotationEntry(
        ["opencode:model-a", "codex:model-b"],
        1,
        [
          { agent: "opencode", blacklistedAt: "2026-03-15T00:00:00.000Z", durationMs: 60_000 },
          { agent: "codex", blacklistedAt: "2026-03-15T00:00:00.000Z", durationMs: 60_000 },
        ],
      );

      expect(decision).toMatchObject({
        entry: "codex:model-b",
        rotationIndex: 1,
        skippedAgents: ["codex", "opencode"],
        clearedBlacklist: true,
      });
    });
  });
});
