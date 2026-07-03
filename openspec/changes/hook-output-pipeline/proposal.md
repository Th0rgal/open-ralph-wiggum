## Why

The current lifecycle hooks system is fire-and-forget — hooks execute but their output cannot influence subsequent hooks or the next iteration. Users cannot build data pipelines where hooks transform context, accumulate state, or forward processed output to the next stage. This limits hooks to side-effects (logging, notifications) rather than enabling them as composable middleware in a processing chain.

## What Changes

- Add a **pipeline context** that flows through hooks and iterations like Express middleware
- Each hook receives the current context, can **read/transform/forward** it, and passes it to the next hook
- The final context from one iteration can be **forwarded to the next iteration** or consumed by hooks
- Hooks can **inject data** into the context that subsequent hooks or the iteration will receive
- Iterations can **receive transformed output** from the hook pipeline before executing
- Add **context passing modes**: `forward` (pass to next), `accumulate` (merge into shared state), `consume` (read-only)

## Capabilities

### New Capabilities
- `pipeline-context`: Core pipeline context system — shared data structure that flows through hooks and iterations with read/transform/forward semantics

### Modified Capabilities
- `lifecycle-hooks`: Hooks now participate in the pipeline — receive context as input, can modify and forward it to the next stage

## Impact

- **Code**: `src/lifecycle-hooks.ts` — add pipeline context parameter to `executeHooks()`, context passing between hooks
- **Code**: `ralph.ts` — thread pipeline context through iteration lifecycle, persist context between iterations
- **State**: New `.ralph/pipeline-context.json` file to persist context between iterations
- **Environment**: New `RALPH_PIPELINE_CONTEXT` environment variable passed to hooks (JSON-encoded)
- **Backward compatibility**: Existing hooks continue to work (context is optional, defaults to empty)
