# Runtime Charter — Shared Harness Runtime

> Adapted from Natural-Language Agent Harnesses (Pan et al., 2026, Appendix C).
> This charter is NOT a benchmark-specific harness. It encodes the shared runtime
> policy that makes different harness skills executable under a common substrate.

## 1. Runtime-Only Parent Role

The top-level agent is an **orchestrator**, never the direct worker.

- Even a nominally single-agent harness runs as "parent runtime + one task child"
- The parent narrates launches, waits, compares, and integrates
- Substantive workspace work happens inside child agents
- This keeps delegation boundaries inspectable and token usage efficient
- **Exception**: trivial tasks (< 3 steps, no verification needed) may run inline

## 2. Minimal Delegated Baseline

If no harness skill is loaded, or if loaded skills are incomplete, the runtime
constructs the thinnest runnable baseline from the task contract and treats
extra skills as overlays.

- A bare task with no skill still gets: TASK.md, a workspace, and RESPONSE.md
- Additional modules (verifier, self-evolution, evidence) layer on top
- This ensures graceful degradation — missing a module never blocks execution

## 3. Call-Graph Recovery with Explicit Context Semantics

The runtime reconstructs roles, stages, and independence requirements from
the skill text, then realizes them as child-agent launches.

### Context forking modes

| Mode | Behavior | Use when |
|------|----------|----------|
| `fork_context=true` | Child inherits parent's accumulated context | Task needs dialogue history, prior findings |
| `fork_context=false` | Child gets only the minimal TASK.md packet | Independent/parallel work, clean slate |

- Disposable one-shot children for independent branches
- Fresh children with clean context for parallel work
- This preserves the original harness's model-call boundaries instead of
  collapsing everything into one long dialogue

## 4. Separated Runtime State and Final Artifacts

Durable intermediate state lives under `STATE_ROOT` (default: `~/.claude/runs/`),
separate from the original task workspace.

- **State path**: `~/.claude/runs/<agent>/<run-id>/state/` — task history, manifests,
  ledgers. Written only when needed for reuse or auditability.
- **Artifacts path**: `~/.claude/runs/<agent>/<run-id>/artifacts/` — judgeable
  deliverables (reports, patches, evidence docs).
- This lets the runtime expose stable evidence surfaces without mirroring
  the entire task workspace.

## 5. Contract-First Completion and Auditability

Benchmark outputs and completion gates remain the primary contract, but the
runtime must leave inspectable evidence when a harness claims staged or
multi-role execution.

- Every agent run produces a RESPONSE.md with: verdict, artifact pointers,
  failure mode (if any), children summary
- The completion gate is checked against the contract, not against the
  agent's self-assessment
- Removing the runtime charter from a run removes the orchestration,
  context, artifact, and reporting discipline — not just prompt text

## 6. Bookkeeping

- `state/task_history.jsonl`: append-only launch and promotion history
- `artifacts/manifest.json`: index promoted files by path for reuse/recovery
- Reopen files by path, not by transient context references
- State must survive context compaction, agent restart, and delegation

## 7. Child Lifecycle

```
LAUNCH → child receives TASK.md [+ optional SKILL.md] → EXECUTE → RESPONSE.md
```

- Each child writes back `children/<id>/RESPONSE.md`
- No prompt, role instruction, reply, or promoted artifact counts as
  transferred until it exists as a named file under STATE_ROOT
- Parent reads child responses via file path, not via context inheritance

## 8. Worktree Isolation for Code-Mutating Children

When multiple children modify the same codebase, each must work in an isolated
git worktree to prevent conflicts.

### Rules

- **Mandatory worktree**: when 2+ children modify files in the same repository
- **Optional worktree**: when a single child makes experimental/risky changes
- **No worktree**: for read-only children (auditors, verifiers, researchers)

### Lifecycle

```
Parent spawns child with isolation: "worktree"
→ Child gets a fresh git worktree (new branch from HEAD)
→ Child works in isolation, commits to its branch
→ Parent reviews child's branch diff
→ Parent merges into main (or discards if rejected)
→ Worktree is cleaned up
```

### Conflict Resolution

If merge conflicts arise between children's worktrees:
1. Identify conflicting files
2. Decide which child's version takes priority (based on task criticality)
3. Merge priority child first, rebase other child, or manually resolve
4. Never silently drop changes

## 9. Agent Definition Files

Agents are defined as individual NLAH files in `~/.claude/agents/<name>/AGENT.md`.

### Required sections in AGENT.md

| Section | Purpose |
|---------|---------|
| **Frontmatter** | name, description, model, tools, skills |
| **Role description** | What this agent does (and doesn't do) |
| **Contract** | inputs, outputs, gates, budget, failure policy |
| **Stage structure** | Explicit topology (which stages, in what order) |
| **Failure taxonomy** | Agent-specific failure modes and recovery |
| **Rules** | Agent-specific constraints |

### Supporting files

```
~/.claude/agents/<name>/
├── AGENT.md          # Role + contract + stage structure
├── references/       # Reference materials (route lists, schemas, etc.)
└── scripts/          # Deterministic adapters (test scripts, linters)
```

## 10. When to Apply This Charter

This charter applies to:
- All scheduled agent runs (`~/.claude/scheduled-tasks/` or equivalent)
- All team-based multi-agent workflows (`~/.claude/teams/` or equivalent)
- All skill invocations that spawn children or require verification
- Any custom slash-command pipelines that orchestrate multiple stages
  (e.g. a deploy pipeline, a bugfix workflow, a security audit)

It does NOT apply to:
- Simple single-turn queries with no tool use
- Read-only exploration tasks
- User-driven interactive conversations (unless they spawn agents)
