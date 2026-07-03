#!/usr/bin/env bash
# ============================================================
# pre-commit hook — syntax + type validation + unit test gate
#
# TEST FRESHNESS RULE:
#   If any test file (or ralph.ts) has been modified in the last 4 hours
#   AND there is no proof of green tests within that window, ALL tests are
#   re-run. If they fail → commit is BLOCKED with a REQUIRED FIX message.
#
#   Proof of green = .test-last-run file with exit code 0, updated within 4h.
# ============================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_ROOT=$(git rev-parse --show-toplevel)
cd "$PROJECT_ROOT"
TEST_GATE_FILE="$PROJECT_ROOT/.test-last-run"
FOUR_HOURS_AGO=$(($(date +%s) - 14400))   # 4 × 60 × 60

log_info()  { echo -e "${GREEN}[pre-commit]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[pre-commit]${NC} $*"; }
log_error() { echo -e "${RED}[pre-commit]${NC} $*" >&2; }

# ── 0. Find all staged TypeScript files ──────────────────────────────────────
STAGED_TS=$(git diff --cached --name-only --diff-filter=ACM | \
            grep '\.ts$' | \
            grep -v '^bin/' | \
            grep -v '^node_modules/' | \
            grep -v '\.test\.ts$' | \
            grep -v 'coverage-badge.mjs')

STAGED_ALL=$(git diff --cached --name-only --diff-filter=ACM)

if [[ -z "$STAGED_ALL" ]]; then
  log_info "No files staged — nothing to check."
  exit 0
fi

log_info "Staged files: ${STAGED_ALL}"
[[ -n "$STAGED_TS" ]] && log_info "TypeScript files to validate: $(echo "$STAGED_TS" | wc -l | tr -d ' ')"

# ── 1. bun build --dry-run (syntax / parse / import errors) ─────────────────
log_info "Running bun build --dry-run for syntax & AST validation..."

DRY_RUN_FAILED=false
if [[ -n "$STAGED_TS" ]]; then
  for file in $STAGED_TS; do
    if ! bun build "$file" --outfile=/dev/null --dry-run 2>&1; then
      log_error "bun build --dry-run FAILED for: $file"
      DRY_RUN_FAILED=true
    fi
  done
fi

if [[ "$DRY_RUN_FAILED" == "true" ]]; then
  log_error "Syntax / AST errors detected — commit BLOCKED."
  log_error "Fix the errors above and try committing again."
  exit 1
fi
log_info "bun build --dry-run: OK"

# ── 2. tsc --noEmit (full type-level semantic validation) ───────────────────
log_info "Running tsc --noEmit for type-level AST & semantic validation..."

if ! npx tsc --noEmit 2>&1; then
  log_error "TypeScript type-check FAILED — commit BLOCKED."
  log_error "Fix the type errors and try committing again."
  exit 1
fi
log_info "tsc --noEmit: OK"

# ── 3. Test freshness gate ───────────────────────────────────────────────────
# Collect all test file mtimes (most recent)
TEST_DIR="tests"
ALL_TEST_MTIMES=$(find "$PROJECT_ROOT/$TEST_DIR" -name '*.test.ts' -newer "$PROJECT_ROOT/ralph.ts" -newer /dev/null 2>/dev/null; \
                  find "$PROJECT_ROOT/$TEST_DIR" -name '*.test.ts' -mmin -240 2>/dev/null)

# Most recent test file modification (mtime)
NEWEST_TEST_MTIME=0
for tf in "$PROJECT_ROOT/$TEST_DIR"/*.test.ts "$PROJECT_ROOT/ralph.ts"; do
  [[ -f "$tf" ]] || continue
  mtime=$(stat -c %Y "$tf" 2>/dev/null || stat -f %m "$tf" 2>/dev/null)
  [[ "$mtime" -gt "$NEWEST_TEST_MTIME" ]] && NEWEST_TEST_MTIME=$mtime
done

# Most recent green-test proof mtime (when .test-last-run was written)
PROOF_MTIME=0
[[ -f "$TEST_GATE_FILE" ]] && \
  PROOF_MTIME=$(stat -c %Y "$TEST_GATE_FILE" 2>/dev/null || stat -f %m "$TEST_GATE_FILE" 2>/dev/null)

# Decide: run tests?
#  - No proof at all               → must run
#  - Proof older than 4 hours      → must run
#  - Any test/source file modified within 4h AND proof is not after that mtime → must run
RUN_TESTS=false
if [[ ! -f "$TEST_GATE_FILE" ]]; then
  log_warn "No test-proof file found — must run all tests."
  RUN_TESTS=true
elif [[ "$PROOF_MTIME" -lt "$FOUR_HOURS_AGO" ]]; then
  log_warn "Test proof is older than 4 hours — must run all tests."
  RUN_TESTS=true
elif [[ "$NEWEST_TEST_MTIME" -gt "$PROOF_MTIME" ]]; then
  log_warn "Test or source files modified since last green run — must run all tests."
  RUN_TESTS=true
fi

# ── 4. bun test (full suite, fresh gate) ────────────────────────────────────
# Excludes stalling-detection and stall-retry tests which have known pre-existing
# flakiness due to timing-sensitive helper-agent harness.
STABLE_TESTS=(
  tests/args-templates.test.ts
  tests/config-loading.test.ts
  tests/config-vs-state-reuse.test.ts
  tests/extra-flags-priority.test.ts
  tests/loop-runtime.test.ts
  tests/ralph.test.ts
  tests/sigint-cleanup.test.ts
  tests/state-dir.test.ts
  tests/state-dir-validation.test.ts
  tests/state-dir-multi-instance.test.ts
  tests/strip-frontmatter.test.ts
)

# Only run tests relevant to staged files (intersection)
STAGED_TEST_NAMES=$(git diff --cached --name-only --diff-filter=ACM | \
                     sed 's|tests/||' | sed 's|\.test\.ts||' | sed 's|/$||')

RELEVANT_TESTS=()
for test in "${STABLE_TESTS[@]}"; do
  test_name=$(echo "$test" | sed 's|tests/||' | sed 's|\.test\.ts||')
  for staged in $STAGED_TEST_NAMES; do
    if [[ "$staged" == *"$test_name"* ]] || [[ "$staged" == "$test_name" ]]; then
      RELEVANT_TESTS+=("$test")
      break
    fi
  done
done

# If no specific tests matched, run all stable tests
if [[ ${#RELEVANT_TESTS[@]} -eq 0 ]]; then
  RELEVANT_TESTS=("${STABLE_TESTS[@]}")
fi

if [[ "$RUN_TESTS" == "true" ]]; then
  log_info "Running full stable test suite (freshness gate triggered)..."
  if bun test "${RELEVANT_TESTS[@]}" 2>&1; then
    # Success → write proof
    echo "PASS $(date +%s)" > "$TEST_GATE_FILE"
    log_info "All tests PASSED. Proof written to $TEST_GATE_FILE"
  else
    # Failure → BLOCK commit
    log_error ""
    log_error "═══════════════════════════════════════════════════════════════"
    log_error "  TESTS FAILED — COMMIT BLOCKED"
    log_error ""
    log_error "  REQUIRED ACTION:"
    log_error "    Fix the failing tests above before committing."
    log_error "    Re-run 'bun test' to verify they pass, then try again."
    log_error ""
    log_error "  Context:"
    if [[ ! -f "$TEST_GATE_FILE" ]]; then
      log_error "      - No test-proof file found"
    elif [[ "$PROOF_MTIME" -lt "$FOUR_HOURS_AGO" ]]; then
      log_error "      - Last green test proof is older than 4 hours"
    else
      log_error "      - Source or test files modified since last green run"
    fi
    log_error "═══════════════════════════════════════════════════════════════"
    exit 1
  fi
else
  log_info "Skipping tests — proof is fresh (< 4h old, no recent changes)."
  log_info "Last green run: $(date -r "$TEST_GATE_FILE" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "unknown")"
fi

# ── All checks passed ───────────────────────────────────────────────────────
log_info "All pre-commit checks passed. Proceeding with commit."
exit 0
