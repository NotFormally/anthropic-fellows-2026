# Orchestrator Patterns — Delegation Rules & Topologies

> Reference guide for the orchestrator agent and any agent that delegates to children.
> Based on NLAH paper findings (Pan et al., 2026).

## Pattern 1: Solver + Verifier (Default)

The minimum viable delegation for any non-trivial task.

```
Orchestrator
├── Solver (fork_context=false)
│   └── Produces candidate output
└── Verifier (fork_context=false)
    └── Inspects candidate, returns PASS/FAIL/UNCERTAIN
```

**When**: Bug fixes, feature implementation, refactoring, any code change.
**Key rule**: Verifier never repairs. If FAIL, solver gets the report and retries.
**Max cycles**: 3 verify-repair loops before escalation.

## Pattern 2: Parallel Solvers (Fan-out / Fan-in)

Independent subtasks executed in parallel, results merged.

```
Orchestrator
├── Solver-A (fork_context=false, worktree) → artifacts/a/
├── Solver-B (fork_context=false, worktree) → artifacts/b/
├── Solver-C (fork_context=false, worktree) → artifacts/c/
└── Integrator (fork_context=true)
    └── Merges artifacts/a/ + b/ + c/ into final output
```

**When**: Multi-file changes, i18n sweeps, multi-route API work.
**Key rule**: Each solver works in its own worktree. Integrator resolves conflicts.
**Parallelism check**: Subtasks must be genuinely independent (no shared state mutations).

## Pattern 3: Multi-Candidate Search

Multiple approaches to the same problem, best one selected.

```
Orchestrator
├── Candidate-1 (fork_context=false, worktree) → approach A
├── Candidate-2 (fork_context=false, worktree) → approach B
├── Candidate-3 (fork_context=false, worktree) → approach C
└── Selector (fork_context=true)
    └── Compares candidates on: task fit, evidence quality, coherence, cost
```

**When**: Complex bugs with unclear root cause, architectural decisions.
**Budget**: K=3 candidates default, K=5 max.
**Key rule**: Candidates must vary hypothesis, not just wording. Vary decomposition,
evidence route, tool plan, or risk preference.
**Selection criteria**: Task fit > evidence quality > coherence > repair cost.

## Pattern 4: Pipeline (Sequential)

Stages that depend on the previous stage's output.

```
Orchestrator
├── Stage-1: Plan (fork_context=true)
│   └── Produces plan.md
├── Stage-2: Execute (fork_context=false)
│   └── Implements plan, produces artifacts
├── Stage-3: Verify (fork_context=false)
│   └── Checks artifacts against contract
└── Stage-4: Ship (fork_context=true)
    └── Commits, deploys, reports
```

**When**: Deploy pipeline, migration workflow, complex feature rollout.
**Key rule**: Each stage reads the previous stage's file output, not context.

## Pattern 5: Audit Fleet

Multiple independent auditors report to a single aggregator.

```
Orchestrator
├── Auditor-1: Security (fork_context=false)
├── Auditor-2: Performance (fork_context=false)
├── Auditor-3: Compliance (fork_context=false)
└── Aggregator (fork_context=true)
    └── Merges findings, deduplicates, prioritizes
```

**When**: Scheduled agent fleet runs, comprehensive codebase audit.
**Key rule**: Auditors are read-only. They report findings but don't fix.

---

## Fork Context Decision Tree

```
Does the child need the current conversation history?
├── YES → fork_context=true
│   └── Does the child modify shared files?
│       ├── YES → fork_context=true + worktree
│       └── NO → fork_context=true (no worktree)
└── NO → fork_context=false
    └── Does the child modify shared files?
        ├── YES → fork_context=false + worktree
        └── NO → fork_context=false (simplest, preferred)
```

## Worktree Decision Tree

```
Does the child modify code in the repo?
├── NO → No worktree needed
└── YES → Are multiple children modifying code?
    ├── YES → Each child gets a worktree (mandatory)
    └── NO → Is the change risky or experimental?
        ├── YES → Use worktree for safety
        └── NO → Worktree optional (use main)
```

## Budget Allocation

| Role | Token Share | Justification |
|------|------------|---------------|
| Orchestrator (parent) | ~10% | Decomposition, delegation, integration |
| Solvers (children) | ~70% | Substantive work |
| Verifiers (children) | ~15% | Quality checks |
| Evidence/reporting | ~5% | Documentation |

If the parent is consuming > 20% of tokens, it's doing too much work itself.

## Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| **Parent-as-worker** | Parent writes code, runs tests | Delegate to children |
| **Context-heavy children** | All children fork full context | Default to `fork_context=false` |
| **Over-delegation** | 10 children for a 5-step task | Use minimal topology |
| **Verifier-as-repairer** | Verifier fixes what it finds | Verifier reports only, solver repairs |
| **Sequential when parallel** | Running independent tasks one-by-one | Parallelize genuinely independent work |
| **Missing verifier** | Code shipped without independent check | Always verify non-trivial changes |
