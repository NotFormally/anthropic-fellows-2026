# Agent Contract Template

> Every agent (scheduled, skill-invoked, or team-spawned) should define an
> explicit execution contract. This replaces implicit assumptions with
> checkable gates.

## Contract Format

Add this block to any SKILL.md, AGENT.md, or agent definition:

```yaml
contract:
  # What the agent needs to start
  inputs:
    required:
      - name: <input_name>
        type: <file | path | string | json>
        description: <what this input is>
    optional:
      - name: <input_name>
        type: <type>
        default: <default_value>

  # What the agent must produce
  outputs:
    required:
      - name: <output_name>
        type: <report | patch | evidence | data | artifact>
        path: <where it goes in the workspace>
        format: <markdown | json | diff | html>
    optional:
      - name: <output_name>
        type: <type>

  # Pre-conditions checked before the agent starts
  gates:
    pre:
      - <condition_1>      # e.g., "project directory exists"
      - <condition_2>      # e.g., "no active deployment in progress"
    post:
      - <condition_1>      # e.g., "all required outputs written"
      - <condition_2>      # e.g., "no regressions introduced"
      - <condition_3>      # e.g., "build passes"

  # Resource limits
  budget:
    max_turns: <number>           # Max agent turns (default: 50)
    max_tokens: <number>          # Max token budget (default: 2M)
    max_children: <number>        # Max child agents (default: 5)
    max_retry: <number>           # Max retry attempts (default: 3)

  # What happens on failure
  failure:
    on_test_failure: repair       # Go to REPAIR stage
    on_tool_error: retry          # Retry with backoff
    on_timeout: report_partial    # Report what's done
    on_contract_violation: fix    # Re-read contract, fix gap
    escalation: meta-agent        # Who to escalate to

  # When to stop
  stop_conditions:
    - all_post_gates_passed
    - budget_exhausted
    - user_abort
    - escalation_accepted
```

## Stage Structure

Every non-trivial agent follows this topology:

```
PLAN → EXECUTE → VERIFY → (REPAIR if failure) → RESPOND
```

| Stage | Owner | Description |
|-------|-------|-------------|
| **PLAN** | Solver | Read task, decompose, identify approach |
| **EXECUTE** | Solver | Do the work, produce candidate output |
| **VERIFY** | Verifier (separate) | Inspect candidate against contract, run checks |
| **REPAIR** | Solver | Fix issues found by verifier (max N cycles) |
| **RESPOND** | Parent | Write RESPONSE.md with verdict + artifacts |

- For trivial tasks, PLAN and VERIFY may be inline
- VERIFY should ideally be a separate agent/role (see `verify` skill)
- REPAIR loops back to VERIFY, not to PLAN (unless fundamental approach is wrong)

## Example: API Tester Contract

```yaml
contract:
  inputs:
    required:
      - name: project_path
        type: path
        description: Path to the project root
      - name: routes_reference
        type: file
        description: List of API routes to test
  outputs:
    required:
      - name: test_report
        type: report
        path: artifacts/api-test-report.md
        format: markdown
      - name: results_data
        type: data
        path: artifacts/test-results.json
        format: json
  gates:
    pre:
      - "project directory exists and has package.json"
      - "dev server is running or can be started"
    post:
      - "all routes tested"
      - "report written with pass/fail per route"
      - "no false positives (re-run flaky tests once)"
  budget:
    max_turns: 100
    max_tokens: 3M
    max_retry: 2
  failure:
    on_test_failure: report_and_continue
    on_tool_error: retry
    on_timeout: report_partial
    escalation: infra-maintainer
  stop_conditions:
    - all_routes_tested
    - budget_exhausted
```

## Applying Contracts

### For Scheduled Agents
Add the contract block directly in the agent's SKILL.md frontmatter or body.

### For Skills
Add the contract block in the skill's SKILL.md.

### For Team Agents
The parent reads each child's contract to:
1. Verify pre-gates before launch
2. Check post-gates on child completion
3. Handle failures according to the failure policy
