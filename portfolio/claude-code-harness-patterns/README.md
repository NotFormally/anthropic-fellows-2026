# claude-code-harness-patterns

Architectural patterns and runtime policy for multi-agent Claude Code
workflows. Documentation only — the implementation is private.

These four documents are the operational core of a personal 17-agent
Claude Code fleet. They cover *how* to delegate, *when* to fork context,
*where* to isolate code-mutating work, *what* to do when something
fails, and *what shape* an agent's contract takes. Together they're the
discipline that lets a parent agent stay below ~10% of the token budget
while children do substantive work in parallel.

If you're building beyond a single Claude Code session — scheduled
agents, multi-step pipelines, team workflows, anything where the parent
spawns children — these patterns are what kept the system inspectable
as it grew.

## What's in this repo

| File | Purpose |
|---|---|
| [`orchestrator-patterns.md`](./orchestrator-patterns.md) | Five named delegation topologies (Solver+Verifier, Parallel Solvers, Multi-Candidate Search, Pipeline, Audit Fleet) with fork-context and worktree decision trees, budget allocation guidance, and a list of named anti-patterns. |
| [`runtime-charter.md`](./runtime-charter.md) | Ten-section runtime policy: parent-as-orchestrator, minimal delegated baseline, call-graph recovery, separated state vs artifacts, contract-first completion, child lifecycle, worktree isolation rules, and agent definition file format. |
| [`failure-taxonomy.md`](./failure-taxonomy.md) | Sixteen named failure modes grouped by stage / verification / orchestration / environment, each with a specific recovery action. Replaces generic `error` reporting with actionable taxonomy. |
| [`contract-template.md`](./contract-template.md) | Explicit YAML contract format for any non-trivial agent (inputs, outputs, gates, budget, failure policy, stop conditions) plus the standard `PLAN → EXECUTE → VERIFY → REPAIR → RESPOND` stage structure. |

## Why publish documentation only

The implementation — the agents themselves, the routing logic, the
self-modification guards, the workspace bookkeeping — is private code
maintained alongside production projects. The *patterns* are the
intellectual content. You can apply them to your own Claude Code setup,
your own scheduled agents, your own team workflows, without needing
the specific code that runs them in mine.

A few specifics that come up in conversation but aren't in the public
docs:

- A Telegram-fronted async agent (~3000 LOC Python) that spawns
  subprocess-sandboxed Gemini executors with approval-gated
  self-modification.
- A scheduled-task scheduler that watches the agent fleet and reports
  health.
- An MCP server suite (knowledge graph, episodic memory, deploy/CI,
  vault operations) that the agents share.

I'm happy to walk through any of these in conversation.

## Provenance

Distilled from operating a personal 17-agent Claude Code fleet across
several production projects (a multi-tenant SaaS, a knowledge-graph
vault, a clinical-AI audit pipeline). The patterns themselves are
generic; the example paths and slash-command names in the docs are
left as examples — adapt them to your environment.

The runtime charter borrows terminology and structural ideas from the
NLAH (Natural-Language Agent Harnesses) framework (Pan et al., 2026)
where applicable.

## License

MIT. See [`LICENSE`](./LICENSE).

## About

Built by Nassim Saighi, MD — a physician with no formal computer-science
training operating a multi-agent Claude Code fleet. GitHub:
[NotFormally](https://github.com/NotFormally).
