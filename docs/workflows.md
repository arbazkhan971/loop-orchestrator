# Dynamic Workflows

A workflow turns a flat team of roles into a **dependency-driven pipeline**. Instead of
starting every agent at once, Loop Orchestrator launches each stage only when its
dependencies have completed, and advances stages as their stop-conditions fire. This is
what makes the "loop" in Loop Orchestrator real: it iterates on a cadence, evaluates
runtime signals, and stops cleanly.

## Define a workflow

Add a `workflows` block to a project in `loop.config.yaml`:

```yaml
workflows:
  - name: delivery
    cadenceSeconds: 30        # how often running stages are re-evaluated
    maxIterations: 50         # hard cap so a run can never spin forever
    stages:
      - name: plan
        role: cto
        completeWhen:
          - "pane-matches:PLAN COMPLETE"
      - name: implement-backend
        role: be1
        dependsOn: [plan]      # waits for plan to complete
        completeWhen:
          - pr-opened
          - tests-pass
        failWhen:
          - tests-fail
      - name: implement-frontend
        role: fe1
        dependsOn: [plan]      # fans out in parallel with the backend stage
        completeWhen:
          - pr-opened
      - name: qa
        role: qa1
        dependsOn: [implement-backend, implement-frontend]
        completeWhen:
          - review-approved
          - "pane-matches:MERGE READY"
```

Each stage maps to a **role** already defined in the project. `dependsOn` references other
**stage** names. The engine computes the runnable set every tick, so diamond shapes
(`plan → {be, fe} → qa`) and fan-out/fan-in work without any extra wiring.

### Stage and workflow options

| Field | Scope | Default | Meaning |
| --- | --- | --- | --- |
| `retries` | stage | `0` | Extra attempts if the stage fails (a failed stage is relaunched until the budget is spent). |
| `timeoutSeconds` | stage | none | Fail the stage if it runs longer than this. A timeout counts as a failure, so it also consumes a retry. |
| `optional` | stage | `false` | The stage failing/being skipped does not block dependents or fail the workflow. |
| `maxParallel` | workflow | unlimited | Cap on how many stages run at once; extra ready stages wait their turn. |
| `cadenceSeconds` | workflow | `30` | How often running stages are re-evaluated. |
| `maxIterations` | workflow | `50` | Hard cap on ticks so a run can never spin forever. |

## Stop-condition vocabulary

`completeWhen` and `failWhen` accept a small, explicit vocabulary:

| Condition | Meaning |
| --- | --- |
| `pane-matches:<regex>` | The agent's captured pane output matches the regex (case-insensitive). |
| `pane-idle:<seconds>` | The pane has not changed for at least N seconds (default completion). |
| `tests-pass` | Named pattern for a passing test/build signal in the pane. |
| `tests-fail` | Named pattern for a failing test/build signal in the pane. |
| `pr-opened` | A `prOpened` signal is set (GitHub-backed; see below). |
| `review-approved` | A `reviewApproved` signal is set. |
| *any other string* | Case-insensitive substring match against the pane (backward compatible). |

A stage completes when **any** `completeWhen` condition matches, and fails when **any**
`failWhen` condition matches (failure is checked first). The matched condition and its
evidence are recorded in the run manifest.

## Run it

```bash
loop run --workflow delivery --run issue-123            # safe mode (prompt-only shells)
loop run --workflow delivery --run issue-123 --execute  # launch real agent commands
loop run --workflow delivery --once                     # single tick: launch ready stages, then exit
loop run --workflow delivery --run issue-123 --resume   # continue an interrupted run
```

If the project defines exactly one workflow, `--workflow` can be omitted.

## Behavior

- **Dynamic launch.** Only stages whose dependencies are all complete start; the rest wait.
- **Optional stages.** `optional: true` means the stage failing or being skipped does not
  block its dependents and does not fail the workflow.
- **Blocking.** If a required dependency fails, its dependents are skipped (cascading), and
  the workflow ends with outcome `failed`.
- **Retries & timeouts.** A failing or timed-out stage is relaunched until its `retries`
  budget is spent, then marked failed for good.
- **Resilient launch.** If starting a stage's session throws (e.g. a transient tmux error),
  it is treated as a retryable failure rather than crashing the whole run.
- **Bounded concurrency.** `maxParallel` limits simultaneous stages; the rest wait.
- **Resume.** `--resume` rebuilds state from the manifest and reattaches to the running
  stages' (deterministically named) tmux sessions, so an interrupted run can continue.
- **Termination.** A run ends as `completed`, `failed`, `max-iterations`, or `stalled`
  (the last meaning a dependency cycle or unreachable stage — nothing left to run).

## Validation

`loop validate` (and `loop doctor`) check workflows before they run: every stage must
reference a real role, every `dependsOn` must reference a real stage, stage names must be
unique, and the dependency graph must be acyclic (a cycle is reported as a readable
`a -> b -> a` path).

## Run manifest

Each tick writes `.loop/runs/<run-id>/workflow.json` with the workflow name, iteration
count, outcome, and per-stage status, start/complete iteration, and stop reason. This is
the auditable record of what the team did.

## GitHub-backed signals

`pr-opened` and `review-approved` read boolean signals supplied by the runner. The default
tmux runner does not populate them yet; they currently resolve to `false` unless your
stage also matches a pane condition. Wiring these to the `gh` CLI is the natural next step
(see `GOAL.md`, Feature G) and slots in behind the existing `signals` hook without changing
the engine.
