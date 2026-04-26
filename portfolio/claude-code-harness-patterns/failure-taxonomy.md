# Failure Taxonomy — Named Failure Modes

> Named failure modes that drive recovery decisions. Each mode maps to a
> specific recovery action, preventing the agent from guessing what to do
> when something goes wrong.

## Taxonomy

### Stage-Level Failures

| Mode | Description | Recovery Action |
|------|-------------|-----------------|
| `format_error` | Output doesn't match required format (wrong file type, missing fields, malformed JSON) | Regenerate the output with explicit format constraints |
| `test_failure` | Tests/checks ran and failed | Go to REPAIR stage: analyze failure output, fix, re-verify |
| `lint_error` | Linter/type-checker found issues | Fix inline, re-run check, continue |
| `build_failure` | Build process failed (compilation, bundling) | Read error, fix source, rebuild |
| `tool_error` | External tool call failed (API timeout, CLI crash, MCP error) | Retry with exponential backoff (max 3), then escalate |
| `permission_denied` | Insufficient permissions for required action | Escalate to parent/user with specific permission needed |
| `timeout` | Budget (turns/tokens/time) exhausted before completion | Report PARTIAL with progress summary and remaining work |
| `contract_violation` | Output doesn't satisfy the task contract (missing required artifacts, wrong scope) | Re-read contract, identify gap, attempt targeted fix |

### Verification Failures

| Mode | Description | Recovery Action |
|------|-------------|-----------------|
| `verifier_reject` | Independent verifier rejected the candidate | Return to solver with verifier's report, attempt fix (max 3 cycles) |
| `verifier_uncertain` | Verifier cannot determine pass/fail | Escalate to parent with evidence doc for human judgment |
| `evidence_incomplete` | Evidence document has uncited or contradicted claims | Complete evidence before releasing response |
| `gate_mismatch` | Local verification passes but external acceptance criteria differ | Flag divergence, report what local checks showed vs. what external expects |

### Orchestration Failures

| Mode | Description | Recovery Action |
|------|-------------|-----------------|
| `child_failure` | A delegated child agent failed | Read child RESPONSE.md, decide: retry child, reassign, or absorb task |
| `child_timeout` | Child agent exceeded its budget | Collect partial results, decide: extend budget or complete with available data |
| `deadlock` | Multiple children blocked waiting on each other | Kill blocked children, restructure task decomposition, relaunch |
| `state_corruption` | Workspace files are missing, malformed, or inconsistent | Rebuild state from task_history.jsonl, restart from last consistent checkpoint |
| `escalation_needed` | Problem exceeds agent's capability or authority | Notify parent/user via the configured human-in-the-loop channel; include context and options |

### Data/Environment Failures

| Mode | Description | Recovery Action |
|------|-------------|-----------------|
| `missing_input` | Required input file/resource not found | Check alternative paths, ask parent, or report FAILURE with details |
| `stale_data` | Input data is outdated (cache, old snapshot) | Refresh from source, clear caches, retry |
| `env_mismatch` | Environment doesn't match expectations (wrong Node version, missing deps) | Report specific mismatch, suggest fix, do not proceed with wrong env |
| `network_error` | Network connectivity issue (DNS, SSL, firewall) | Retry with backoff, then report with diagnostic info |

## Usage Rules

1. **Always name the failure mode** in RESPONSE.md when verdict is not SUCCESS
2. **Never use generic "error"** — pick the most specific mode from this taxonomy
3. **Recovery actions are mandatory** — the agent must attempt the specified recovery
   before escalating or reporting failure
4. **Compound failures**: if multiple modes apply, list them in order of severity
   and address the most severe first
5. **New modes**: if a failure doesn't fit any existing mode, create a new entry
   in this taxonomy with a descriptive name, then use it

## Escalation Chain

```
Agent → Parent Agent → Meta-Agent → User (via configured human-in-the-loop channel)
```

- Escalate after exhausting the recovery action for the failure mode
- Always include: failure mode name, what was tried, evidence path
- Never silently swallow a failure — it must be named and reported
