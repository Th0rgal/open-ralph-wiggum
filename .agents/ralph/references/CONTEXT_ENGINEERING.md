# Context Engineering Reference

This document explains the malloc/free metaphor for LLM context management that underlies the Ralph technique.

## The malloc() Metaphor

In traditional programming:
- `malloc()` allocates memory
- `free()` releases memory
- Memory leaks occur when you allocate without freeing

In LLM context:
- Reading files, receiving responses, tool outputs = `malloc()`
- **There is no `free()`** - context cannot be released
- The only way to "free" is to start a new conversation

## Why This Matters

### Context Pollution

When you work on multiple unrelated tasks in the same context:

```
Task 1: Build authentication → context contains auth code, JWT docs, security patterns
Task 2: Build UI components → context now ALSO contains auth stuff

Result: LLM might suggest auth-related patterns when building UI
        or mix concerns inappropriately
```

### Autoregressive Failure

LLMs predict the next token based on ALL context. When context contains:
- Unrelated information
- Failed attempts
- Mixed concerns

The model can "spiral" into wrong territory, generating increasingly off-base responses.

### The Gutter Metaphor

> "If the bowling ball is in the gutter, there's no saving it."

Once context is polluted with failed attempts or mixed concerns, the model will keep referencing that pollution. Starting fresh is often faster than trying to correct course.

## Context Health Indicators

### 🟢 Healthy Context
- Single focused task
- Relevant files only
- Clear progress
- Under 60% capacity

### 🟡 Warning Signs
- Multiple unrelated topics discussed
- Several failed attempts in history
- Approaching 80% capacity
- Repeated similar errors

### 🔴 Critical / Gutter
- Mixed concerns throughout
- Circular failure patterns
- Over 90% capacity
- Model suggesting irrelevant solutions

## Best Practices

### 1. One Task Per Context

Don't ask "fix the auth bug AND add the new feature". Do them in separate conversations.

### 2. Fresh Start on Topic Change

Finished auth? Start a new conversation for the next feature.

### 3. Don't Redline

Stay under 80% of context capacity. Quality degrades as you approach limits.

### 4. Recognize the Gutter

If you're seeing:
- Same error 3+ times
- Solutions that don't match the problem
- Circular suggestions

Start fresh. Your progress is in the files.

### 5. State in Files, Not Context

Write progress to files. The next conversation can read them. Context is ephemeral; files are permanent.

## Ralph's Approach

The original Ralph technique (`while :; do cat PROMPT.md | agent ; done`) naturally implements these principles:

1. **Each iteration is a fresh process** - Context is freed
2. **State persists in files** - Progress survives context resets
3. **Same prompt each time** - Focused, single-task context
4. **Failures inform guardrails** - Learning without context pollution

This Cursor implementation aims to bring these benefits while working within Cursor's session model.

## Measuring Context

Rough estimates:
- 1 token ≈ 4 characters
- Average code file: 500-2000 tokens
- Large file: 5000+ tokens
- Conversation history: 100-500 tokens per exchange

Track allocations in `.ralph/context-log.md` to stay aware.

## When to Start Fresh

**Definitely start fresh when:**
- Switching to unrelated task
- Context over 90% full
- Same error 3+ times
- Model suggestions are off-topic

**Consider starting fresh when:**
- Context over 70% full
- Significant topic shift within task
- Feeling "stuck"
- Multiple failed approaches in history
