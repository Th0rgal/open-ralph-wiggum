---
name: prd
description: "Generate a Product Requirements Document (PRD) as JSON for Ralph. Triggers on: create a prd, write prd for, plan this feature, requirements for, spec out."
---

# PRD Generator (JSON Only)

Create a structured JSON PRD that Ralph can execute deterministically. This PRD is the **single source of truth** for stories, gates, and status.

---

## The Job

1. Receive a feature description from the user
2. Ask **5–10** clarifying questions (with lettered options), in batches of up to 5 at a time (ask 5, wait for answers, then ask the next batch if needed).
3. **Always ask about quality gates** (commands that must pass)
4. Generate a **detailed** JSON PRD and save it to the provided path

**Important:** Do NOT implement anything. Only generate JSON.

---

## Step 1: Clarifying Questions

Ask questions even if the prompt seems clear. The goal is to capture missing product details, stack choices, and UI/route structure so the PRD is implementable without guesswork. Focus on:

- **Problem/Goal:** What problem does this solve?
- **Core Functionality:** What are the key actions?
- **Scope/Boundaries:** What should it NOT do?
- **Success Criteria:** How do we know it's done?
- **Stack + Environment:** frameworks, hosting, runtime, database, auth approach
- **UI + Routes:** key screens, navigation, route map, layout constraints
- **Data Model + Import Format:** entities, relationships, external data shape
- **Rules/Calculations:** business logic, progression rules, edge cases
- **Quality Gates:** tests, lint, typecheck, build/dev verification (REQUIRED)

Always ask explicitly:
- **Is this a new project or an existing codebase?**

### Format Questions Like This:

```
1. What is the primary goal of this feature?
   A. Improve user onboarding experience
   B. Increase user retention
   C. Reduce support burden
   D. Other: [please specify]

2. Who is the target user?
   A. New users only
   B. Existing users only
   C. All users
   D. Admin users only

3. What quality commands must pass for each story?
   A. npm test
   B. npm run lint
   C. npm run typecheck
   D. Other: [specify]

Note: All example questions and options in this section are illustrative only. Do not copy them verbatim into the PRD unless the user explicitly chooses them. Derive the final quality gates and requirements from the user's answers and the feature context.

4. What stack + hosting are we using (and any constraints)?
   A. React + Vite (static hosting)
   B. Next.js (Node/Edge)
   C. TanStack Start (Cloudflare)
   D. Other: [specify]

5. What UI screens/routes are required?
   A. Minimal (1–2 pages)
   B. Basic app shell (dashboard + detail pages)
   C. Full routing map (list all routes)
   D. Other: [specify]
```

---

## Step 2: JSON Structure

Output a JSON file with this shape (include detailed top-level fields so the PRD is fully self-contained):

```json
{
  "version": 1,
  "project": "Feature Name",
  "overview": "Short problem + solution summary",
  "goals": [
    "Goal 1",
    "Goal 2"
  ],
  "nonGoals": [
    "Explicitly out of scope items"
  ],
  "successMetrics": [
    "How success is measured"
  ],
  "openQuestions": [
    "Remaining unknowns"
  ],
  "stack": {
    "framework": "TanStack Start",
    "hosting": "Cloudflare",
    "database": "D1",
    "auth": "describe approach"
  },
  "routes": [
    { "path": "/", "name": "Home", "purpose": "..." }
  ],
  "uiNotes": [
    "Layout or component requirements"
  ],
  "dataModel": [
    { "entity": "Workout", "fields": ["id", "userId", "date", "notes"] }
  ],
  "importFormat": {
    "description": "Expected JSON shape",
    "example": { "programName": "..." }
  },
  "rules": [
    "Key business rules / calculations"
  ],
  "qualityGates": ["npm run test:ping"],
  "stories": [
    {
      "id": "US-001",
      "title": "Short story title",
      "status": "open",
      "dependsOn": [],
      "description": "As a [user], I want [feature] so that [benefit].",
      "acceptanceCriteria": [
        "Specific verifiable criterion",
        "Another criterion"
      ]
    }
  ]
}
```

### Rules
- **IDs**: Sequential (`US-001`, `US-002`, ...)
- **Status**: Always `"open"` for new stories
- **DependsOn**: Use IDs only; empty array if none
- **Quality Gates**: Only at the top-level `qualityGates`
- **Acceptance Criteria**: Verifiable, specific, testable
- **Every story must include**: at least 1 example + 1 negative case
- **UI stories**: include explicit routes, components, and UI states
- **New projects**: include initial setup stories (scaffold, env/config, local dev, deploy basics, **package installs**)
- **Dependencies**: any new package/library introduced must be called out with install commands in acceptance criteria (e.g., `npm install <pkg>`), plus any required config or scripts.
- **Ordering**: if this is a new project, the **first story must be setup** (scaffold + installs + scripts + env/config). Migrations or data model work come after setup.

---

## Output Requirements

- Save the JSON to the exact path provided in the prompt (e.g., `.agents/tasks/prd-<slug>.json`)
- Output **only** the JSON file content (no Markdown PRD)
- Do not include extra commentary in the file

After saving, tell the user:
`PRD JSON saved to <path>. Close this chat and run \`ralph build\`.`

If the prompt provides a **directory** (not a filename), choose a short filename:
- `prd-<short-slug>.json` where `<short-slug>` is 1–3 meaningful words (avoid filler like “i want to”).
- Examples: `prd-workout-tracker.json`, `prd-usage-billing.json`

---

## Story Size (Critical)

Each story must be completable in a **single Ralph iteration**.
If a story feels too large, split it into multiple smaller stories with dependencies.

---

## Example Output (JSON)

```json
{
  "version": 1,
  "project": "Task Priority System",
  "overview": "Add priority levels to tasks so users can focus on what matters most.",
  "goals": [
    "Allow assigning priority (high/medium/low) to any task",
    "Enable filtering by priority"
  ],
  "nonGoals": [
    "No automatic priority assignment"
  ],
  "successMetrics": [
    "Users can change priority in under 2 clicks"
  ],
  "openQuestions": [
    "Should priority affect ordering within a column?"
  ],
  "stack": {
    "framework": "React",
    "hosting": "Cloudflare Pages",
    "database": "D1",
    "auth": "single shared login"
  },
  "routes": [
    { "path": "/tasks", "name": "Task List", "purpose": "View and filter tasks" },
    { "path": "/tasks/:id", "name": "Task Detail", "purpose": "Edit task priority" }
  ],
  "uiNotes": [
    "Priority badge colors: high=red, medium=yellow, low=gray"
  ],
  "dataModel": [
    { "entity": "Task", "fields": ["id", "title", "priority"] }
  ],
  "importFormat": {
    "description": "Not applicable",
    "example": {}
  },
  "rules": [
    "Priority defaults to medium when not set"
  ],
  "qualityGates": ["npm run test:ping"],
  "stories": [
    {
      "id": "US-001",
      "title": "Add priority field to database",
      "status": "open",
      "dependsOn": [],
      "description": "As a developer, I want to store task priority so it persists across sessions.",
      "acceptanceCriteria": [
        "Add priority column with default 'medium'",
        "Example: creating a task without priority -> defaults to 'medium'",
        "Negative case: invalid priority 'urgent' -> validation error",
        "Migration runs successfully"
      ]
    }
  ]
}
```
