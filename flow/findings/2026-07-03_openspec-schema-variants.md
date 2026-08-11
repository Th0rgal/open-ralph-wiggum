# OpenSpec Schema Variants & Lifecycle Research

**Date**: 2026-07-03  
**Context**: Research on OpenSpec schema patterns and archive/sync behavior

## Schema Variants

### Built-in Schemas (OpenSpec core)

| Schema | Artifacts | Use Case | Reference |
|--------|-----------|----------|-----------|
| **spec-driven** | proposal → specs → design → tasks | General purpose | [schema.yaml](https://github.com/Fission-AI/OpenSpec/blob/master/schemas/spec-driven/schema.yaml) |
| **workspace-planning** | proposal → specs → design → tasks | Multi-repo coordination | [schema.yaml](https://github.com/Fission-AI/OpenSpec/blob/master/schemas/workspace-planning/schema.yaml) |

### Community Schemas

| Schema | Artifacts | Use Case | Reference |
|--------|-----------|----------|-----------|
| **minimalist** | specs → tasks | Small, low-risk changes (skip proposal) | [intent-driven-dev](https://github.com/intent-driven-dev/openspec-schemas/blob/main/openspec/schemas/minimalist/schema.yaml) |
| **rapid** | proposal → tasks | Quick iterations (skip specs/design) | [customization.md](https://github.com/Fission-AI/OpenSpec/blob/master/docs/customization.md) |
| **intent-driven** | proposal → specs → design → **adr** → tasks | Adds Architecture Decision Records | [intent-driven-dev](https://github.com/intent-driven-dev/openspec-schemas/blob/main/openspec/schemas/intent-driven/) |
| **event-driven** | Event Storming → AsyncAPI specs | Event-centric systems | [intent-driven-dev](https://github.com/intent-driven-dev/openspec-schemas/blob/main/openspec/schemas/event-driven/) |
| **behaviour-driven** | proposal → Gherkin specs → design → tasks | BDD-style with GIVEN/WHEN/THEN | [intent-driven-dev](https://github.com/intent-driven-dev/openspec-schemas/blob/main/openspec/schemas/behaviour-driven/) |
| **superpowers-bridge** | **brainstorm** → proposal → design → specs → tasks → **plan** → **verify** → **retrospective** | Full Superpowers integration | [JiangWay](https://github.com/JiangWay/openspec-schemas/blob/main/superpowers-bridge/schema.yaml) |
| **with-review** | proposal → specs → design → **review** → tasks | Pre-implementation review gate | [customization.md](https://github.com/Fission-AI/OpenSpec/blob/master/docs/customization.md) |
| **TDD schema** | proposal → specs → **tests** → design → tasks | Test-Driven Development workflow | [Arggon](https://github.com/Arggon/openspec-tdd-schema) |

### Key Patterns

1. **Skip artifacts for speed**: minimalist/rapid drop proposal or design
2. **Add artifacts for rigor**: ADR, review, verify, retrospective
3. **Reorder for workflow**: some put design before specs, or add brainstorm first
4. **Namespace prefixes**: our convention uses `NN-opsx-<name>` format

## Archive & Sync Behavior

### What Archive Does

1. **Merges delta specs** → main specs (`openspec/specs/`)
2. **Moves change folder** → `openspec/changes/archive/YYYY-MM-DD-<name>/`
3. **Preserves full context** (proposal, design, tasks, specs)

### What Sync Does

- **Optional manual merge** of deltas before archiving
- Useful for long-running changes where you want specs updated mid-work
- Archive handles sync automatically if you skip it

### What Happens If You Forget

| Problem | Impact |
|---------|--------|
| **Stale main specs** | Delta specs NOT merged to `openspec/specs/` |
| **Accumulating changes** | `openspec/changes/` fills with completed-but-not-archived folders |
| **No source of truth** | Main specs don't reflect shipped behavior |
| **Parallel change conflicts** | New changes base on outdated specs |

### Cleanup Commands

```bash
openspec list                    # see all active changes
openspec validate --all          # check for issues
# Then manually archive old ones:
/opsx:archive <old-change-name>
```

## References

- [OpenSpec Customization](https://github.com/Fission-AI/OpenSpec/blob/master/docs/customization.md)
- [OpenSpec Concepts](https://github.com/Fission-AI/OpenSpec/blob/master/docs/concepts.md)
- [OpenSpec FAQ](https://github.com/Fission-AI/OpenSpec/blob/master/docs/faq.md)
- [Community Schemas Catalog](https://github.com/Fission-AI/OpenSpec/blob/master/docs/customization.md#community-schemas)
- [intent-driven-dev Blog](https://intent-driven.dev/blog/2026/02/12/openspec-custom-schemas/)
