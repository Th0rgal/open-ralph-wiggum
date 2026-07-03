## Context

The lifecycle hooks system (just implemented) executes bash scripts at 9 lifecycle events. Currently, hooks are isolated — they receive environment variables but cannot pass data to subsequent hooks or influence the next iteration's context. This limits hooks to side-effects (logging, notifications) rather than enabling composable data transformation pipelines.

The user wants Express-style middleware where each hook can:
1. Receive the current pipeline context
2. Transform/accumulate data
3. Forward the modified context to the next hook or iteration

## Goals / Non-Goals

**Goals:**
- Pipeline context flows through hooks in execution order (like Express middleware chain)
- Each hook receives context via environment variable, can output modified context
- Context persists between iterations (stored in `.ralph/pipeline-context.json`)
- Iterations can receive the final pipeline context before executing
- Backward compatible — existing hooks without context handling continue to work

**Non-Goals:**
- Async/parallel hook execution (hooks remain sequential)
- Complex context schemas or validation (context is arbitrary JSON)
- Context versioning or rollback (simple last-write-wins)
- Hook-to-hook direct communication (all via shared context)

## Decisions

### D1: Context passing via environment variable + stdout protocol

**Choice**: Hooks receive context via `RALPH_PIPELINE_CONTEXT` env var (JSON string). Hooks output modified context to stdout using a delimiter pattern:
```
---RALPH_PIPELINE_CONTEXT---
{"key": "value"}
---END_PIPELINE_CONTEXT---
```

**Alternatives considered:**
- Stdin/stdout JSON streaming — complex parsing, conflicts with regular output
- Temp file per hook — filesystem overhead, cleanup complexity
- Dedicated file descriptor — not portable across bash versions

**Rationale**: Env var for input is simple and portable. Stdout delimiter pattern is easy to parse, doesn't conflict with regular hook output (which is prefixed with `[hook:<name>]`), and allows hooks to output both regular messages and context updates.

### D2: Context merging strategy — shallow merge with namespace support

**Choice**: When a hook outputs context, it's shallow-merged into the pipeline context. Hooks can use namespaced keys (e.g., `hookName.key`) to avoid collisions. Final context is the result of all merges in execution order.

**Alternatives considered:**
- Deep merge — complex, unexpected behavior with nested objects
- Replace entire context — loses data from previous hooks
- Immutable context with return values — breaks middleware pattern

**Rationale**: Shallow merge is predictable and simple. Namespacing via key prefixes (convention) prevents collisions without requiring complex merge logic. Last-write-wins for same key is intuitive.

### D3: Context persistence — JSON file in state directory

**Choice**: Pipeline context is persisted to `.ralph/pipeline-context.json` after each iteration. Loaded at loop start, updated after each iteration's hook pipeline completes.

**Alternatives considered:**
- In-memory only — lost on loop restart, breaks cross-iteration forwarding
- Database — overkill for this use case
- State file integration — couples pipeline context to loop state, harder to inspect

**Rationale**: JSON file is simple, inspectable, and survives loop restarts. Separate from loop state file to keep concerns isolated. Users can `cat` it to debug.

### D4: Context injection into iterations — via environment variable

**Choice**: The final pipeline context (after all hooks for an event) is available to the agent iteration via `RALPH_PIPELINE_CONTEXT` env var. The agent can read it if needed, but it's not automatically injected into the prompt.

**Alternatives considered:**
- Auto-inject into prompt — too magical, users can't control formatting
- Prompt template variable — requires template changes, more complex
- Context file that agent reads — agent must know to read it, less discoverable

**Rationale**: Env var is consistent with other hook data passing. Agent can access it if the prompt instructs it to. Users can build custom prompt templates that reference it if needed. Keeps the system explicit rather than magical.

### D5: Execution order — hooks run sequentially, context flows through

**Choice**: Hooks execute in priority order (existing behavior). Each hook receives the context as modified by all previous hooks in the chain. This creates a true middleware pipeline where data flows through the chain.

**Alternatives considered:**
- All hooks receive same initial context — breaks middleware pattern
- Parallel execution with merge — complex, non-deterministic ordering

**Rationale**: Sequential execution with flowing context matches Express middleware semantics. Each hook sees the accumulated state from previous hooks, enabling transformations like "hook A extracts data, hook B enriches it, hook C forwards to next iteration".

## Risks / Trade-offs

- **[Context size]** → Large contexts could exceed env var limits (typically 128KB-2MB). Mitigation: document size limits, recommend keeping context small (metadata, not full data). Future: file-based context for large payloads.
- **[Parsing failures]** → Malformed JSON in stdout could break context extraction. Mitigation: robust parsing with fallback (ignore malformed output, log warning). Delimiter pattern reduces false positives.
- **[Collision risk]** → Multiple hooks writing same key causes last-write-wins. Mitigation: document namespacing convention (`hookName.key`), provide examples.
- **[Debugging complexity]** → Hard to trace context flow through multiple hooks. Mitigation: add `--verbose-hooks` flag that logs context at each stage. Provide `ralph pipeline show` command to inspect current context.
- **[Performance]** → Context serialization/deserialization adds overhead per hook. Mitigation: only serialize when context changes, cache parsed context within iteration.
