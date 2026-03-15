export interface BlacklistedAgent {
  agent: string;
  blacklistedAt: string;
  durationMs: number;
}

export interface LoopOwnershipState {
  active: boolean;
  pid?: number;
}

export type LoopOwnershipDecision =
  | { status: "fresh" }
  | { status: "resume"; ownerPid?: number }
  | { status: "already-running"; ownerPid: number };

export class StreamActivityTracker {
  private readonly now: () => number;
  private activityAt: number;

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.activityAt = this.now();
  }

  markChunk(chunk: string): void {
    if (chunk.length > 0) {
      this.activityAt = this.now();
    }
  }

  markLine(): void {
    this.activityAt = this.now();
  }

  get lastActivityAt(): number {
    return this.activityAt;
  }
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

export function decideLoopOwnership(
  existingState: LoopOwnershipState | null,
  currentPid: number = process.pid,
): LoopOwnershipDecision {
  if (!existingState?.active) {
    return { status: "fresh" };
  }

  if (existingState.pid && existingState.pid !== currentPid && isProcessAlive(existingState.pid)) {
    return { status: "already-running", ownerPid: existingState.pid };
  }

  return { status: "resume", ownerPid: existingState.pid };
}

export function pruneExpiredBlacklistedAgents(
  entries: BlacklistedAgent[],
  nowMs: number,
): { active: BlacklistedAgent[]; expiredAgents: string[] } {
  const active: BlacklistedAgent[] = [];
  const expiredAgents: string[] = [];

  for (const entry of entries) {
    const blacklistedTime = new Date(entry.blacklistedAt).getTime();
    const expiryTime = blacklistedTime + entry.durationMs;
    if (nowMs >= expiryTime) {
      expiredAgents.push(entry.agent);
      continue;
    }
    active.push(entry);
  }

  return { active, expiredAgents };
}

export function selectRotationEntry(
  rotation: string[],
  rotationIndex: number,
  blacklistedAgents: BlacklistedAgent[],
): {
  entry: string;
  rotationIndex: number;
  skippedAgents: string[];
  clearedBlacklist: boolean;
} {
  const normalizedIndex = ((rotationIndex % rotation.length) + rotation.length) % rotation.length;
  const blacklisted = new Set(blacklistedAgents.map((entry) => entry.agent));
  const skippedAgents: string[] = [];

  for (let attempts = 0; attempts < rotation.length; attempts++) {
    const currentIndex = (normalizedIndex + attempts) % rotation.length;
    const entry = rotation[currentIndex];
    const [agent] = entry.split(":");
    if (!blacklisted.has(agent)) {
      return {
        entry,
        rotationIndex: currentIndex,
        skippedAgents,
        clearedBlacklist: false,
      };
    }
    skippedAgents.push(agent);
  }

  return {
    entry: rotation[normalizedIndex],
    rotationIndex: normalizedIndex,
    skippedAgents,
    clearedBlacklist: true,
  };
}
