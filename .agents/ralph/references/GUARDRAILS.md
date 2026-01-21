# Guardrails Reference ("Signs")

This document explains how to create and use guardrails in Ralph.

## The Signs Metaphor

From Geoffrey Huntley:

> "Ralph is very good at making playgrounds, but he comes home bruised because he fell off the slide, so one then tunes Ralph by adding a sign next to the slide saying 'SLIDE DOWN, DON'T JUMP, LOOK AROUND,' and Ralph is more likely to look and see the sign."

Signs are explicit instructions added to prevent known failure modes.

## Anatomy of a Sign

```markdown
### Sign: [Descriptive Name]
- **Trigger**: When this situation occurs
- **Instruction**: What to do instead
- **Added after**: When/why this was added
- **Example**: Concrete example if helpful
```

## Types of Signs

### 1. Preventive Signs

Stop problems before they happen:

```markdown
### Sign: Validate Before Trust
- **Trigger**: When receiving external input
- **Instruction**: Always validate and sanitize input before using it
- **Added after**: Iteration 3 - SQL injection vulnerability
```

### 2. Corrective Signs

Fix recurring mistakes:

```markdown
### Sign: Check Return Values
- **Trigger**: When calling functions that can fail
- **Instruction**: Always check return values and handle errors
- **Added after**: Iteration 7 - Null pointer exception
```

### 3. Process Signs

Enforce good practices:

```markdown
### Sign: Test Before Commit
- **Trigger**: Before committing changes
- **Instruction**: Run the test suite and ensure all tests pass
- **Added after**: Iteration 2 - Broken tests committed
```

### 4. Architecture Signs

Guide design decisions:

```markdown
### Sign: Single Responsibility
- **Trigger**: When a function grows beyond 50 lines
- **Instruction**: Consider splitting into smaller, focused functions
- **Added after**: Iteration 12 - Unmaintainable god function
```

## When to Add Signs

Add a sign when:

1. **The same mistake happens twice** - Once is learning, twice is a pattern
2. **A subtle bug is found** - Prevent future occurrences
3. **A best practice is violated** - Reinforce good habits
4. **Context-specific knowledge is needed** - Project-specific conventions

## Sign Lifecycle

### Creation

```markdown
### Sign: [New Sign]
- **Trigger**: [When it applies]
- **Instruction**: [What to do]
- **Added after**: Iteration N - [What happened]
```

### Refinement

If a sign isn't working:
- Make the trigger more specific
- Make the instruction clearer
- Add examples

### Retirement

Signs can be removed when:
- The underlying issue is fixed at a deeper level
- The sign is no longer relevant
- The sign is causing more problems than it solves

## Example Signs Library

### Security

```markdown
### Sign: Sanitize All Input
- **Trigger**: Any user-provided data
- **Instruction**: Use parameterized queries, escape HTML, validate types
- **Example**: `db.query("SELECT * FROM users WHERE id = ?", [userId])`
```

### Error Handling

```markdown
### Sign: Graceful Degradation
- **Trigger**: External service calls
- **Instruction**: Always have a fallback for when services are unavailable
- **Example**: Cache results, provide default values, show friendly errors
```

### Testing

```markdown
### Sign: Test the Unhappy Path
- **Trigger**: Writing tests for new functionality
- **Instruction**: Include tests for error cases, edge cases, and invalid input
```

### Code Quality

```markdown
### Sign: Explain Why, Not What
- **Trigger**: Writing comments
- **Instruction**: Comments should explain reasoning, not describe obvious code
- **Example**: `// Using retry because API is flaky under load` not `// Call the API`
```

## Automatic Sign Detection

The Ralph hooks can automatically detect some patterns and suggest signs:

- **Thrashing**: Same file edited many times → "Step back and reconsider"
- **Repeated errors**: Same test failing → "Check the test assumptions"
- **Large changes**: Big diffs → "Consider smaller increments"

These are logged in `.ralph/failures.md` and can be promoted to guardrails.

## Using Signs Effectively

### Do

- Keep signs concise and actionable
- Include concrete examples
- Update signs when they're not working
- Remove outdated signs

### Don't

- Add signs for every minor issue
- Make signs too vague ("be careful")
- Ignore signs that keep triggering
- Let the guardrails file become overwhelming

## Integration with Ralph

Signs are:
1. Stored in `.ralph/guardrails.md`
2. Injected into context at the start of each iteration
3. Referenced when relevant situations arise
4. Updated based on observed failures

The goal is a self-improving system where each failure makes future iterations smarter.
