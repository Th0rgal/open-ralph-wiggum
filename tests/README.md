# SIGINT Cleanup Tests

## Overview
Comprehensive test suite for SIGINT (Ctrl+C) cleanup behavior in Ralph loop.

## Important: Behavioral Testing Approach

These tests use **behavioral verification**, not state-based mocking. This is critical because:

1. **TimerMock/ProcessMock don't work across process boundaries** - The test spawns a separate `ralphProcess` which has its own timer/subprocess state
2. **We verify observable behavior** - Output patterns, process state, file system changes
3. **More reliable tests** - Not coupled to internal implementation details

## Test Files

### `sigint-cleanup.test.ts`
Main test file containing 22 test cases across 5 categories:

#### 1. Basic SIGINT Handling (3 tests)
- Stops heartbeat timer on single SIGINT (behavioral: no new heartbeats after SIGINT)
- Handles SIGINT when no subprocess running
- Kills subprocess on SIGINT (behavioral: process tree termination)

#### 2. Timer Cleanup (3 tests)
- Clears heartbeat timer before process.exit
- No stale timer callbacks after cleanup (behavioral: no output after cleanup)
- Handles multiple concurrent timers

#### 3. Subprocess Cleanup (3 tests)
- Closes subprocess stdout/stderr streams
- Awaits subprocess exit before full cleanup
- Handles subprocess that ignores SIGTERM

#### 4. Edge Cases (6 tests)
- Handles double SIGINT (force stop)
- Handles rapid triple SIGINT
- Handles SIGINT during error condition
- Handles SIGINT during readline prompt
- Handles re-entrant cleanup
- Handles SIGINT when already stopping

#### 5. State Management (5 tests)
- Clears state on SIGINT
- Clears pending questions on SIGINT
- Preserves history for --status after SIGINT
- Updates stopping flag atomically
- Handles SIGINT during file snapshot

## Test Fixtures (`fixtures/`)

### `slow-exit.ts`
Script that ignores SIGTERM for testing subprocess cleanup behavior.

### `infinite-loop.ts`
Never-ending process for testing forceful termination.

### `spawn-children.ts`
Spawns child processes for testing process tree cleanup.

## Test Helpers (`helpers/`)

### `sigint-mock.ts`
Utilities for behavioral testing:
- `SignalSender` - Send signals to processes
- `OutputBuffer` - Collect and analyze process output
- `spawnRalph` - Spawn ralph with options
- `cleanupProcess` - Force kill process tree
- Environment-aware timeouts (`CLEANUP_WAIT`, `PROCESS_START_WAIT`, `HEARTBEAT_WAIT`)

### `process-tree.ts` (NEW)
Utilities for process tree management:
- `getProcessTree(ppid)` - Get all descendant PIDs
- `isProcessRunning(pid)` - Check if process is alive
- `killProcessTree(pid, signal)` - Kill process tree
- `forceKillProcessTree(pid)` - Force kill with escalation

## Running Tests

```bash
# Run all tests (serial to avoid interference)
bun test tests/sigint-cleanup.test.ts

# Run with verbose output
bun test tests/sigint-cleanup.test.ts --verbose

# Run specific test category
bun test tests/sigint-cleanup.test.ts -t "Timer Cleanup"

# In CI (longer timeouts automatically applied)
CI=true bun test tests/sigint-cleanup.test.ts
```

## RED Phase Note
These tests are part of the TDD RED phase. They are **expected to FAIL** initially because the SIGINT cleanup feature hasn't been fully implemented yet. After running these tests:

1. Review failures to understand requirements
2. Implement the fix (GREEN phase)
3. Re-run tests to verify they pass
4. Refactor if needed (REFACTOR phase)

## What Needs to Be Fixed
Based on the test failures, the following should be implemented:

1. **Timer Cleanup**: Explicitly clear all timers in SIGINT handler before process.exit
2. **Subprocess Cleanup**: Wait for subprocess to exit before full cleanup
3. **Double SIGINT**: Implement force-stop on second SIGINT
4. **State Management**: Ensure proper cleanup order
5. **Atomic Flag Updates**: Prevent race conditions in stopping flag

## Test Design Principles

1. **Behavioral Verification**: Test observable behavior, not internal state
2. **Process Tree Tracking**: Verify subprocess cleanup using OS tools
3. **Output Analysis**: Check for heartbeat patterns in output
4. **Environment-Aware Timeouts**: Longer timeouts in CI environments
5. **Robust Cleanup**: Force-kill fallbacks in afterEach
6. **Isolation**: Each test is independent and cleans up after itself
7. **Serial Execution**: Tests should run serially to avoid interference

## Limitations

1. **Timing-dependent**: Behavioral tests require waiting for observable effects
2. **Output format coupling**: Tests depend on specific log formats
3. **Platform-specific**: Process tree tracking uses `ps` commands
4. **CI reliability**: May need longer timeouts in slower environments
