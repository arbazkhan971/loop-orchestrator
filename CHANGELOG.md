# Changelog

## 0.4.0

### Mission-control dashboard

Replaced the flat task table with an insightful, actionable dashboard (informed by how OpenHands, AutoGen Studio, and agent-observability tools like Langfuse/AgentOps present runs):

- **KPI bar** — progress %, agents active, in-progress/blocked, retries/rejections, **estimated time left**, and **spend vs budget** with amber/red thresholds.
- **Needs-attention strip** — blocked / rejected / escalated tasks surfaced with their failure reason, plus budget warnings.
- **Agent swimlanes** — per-SME card with current task, a live idle timer that flags stuck agents, spend, and an expandable terminal-output peek.
- **Dependency-aware task board** — kanban by status with dependency chips (red = blocking, green = satisfied), a "ready ▶" badge, and **critical-path** markers.
- **Activity timeline** — merged event + inter-agent message feed.

New zero-dependency JSON endpoints: `/api/overview`, `/api/agents`, `/api/timeline`, `/api/graph`, `/api/attention` (board fold + cost ledger aggregations in `src/dashboard/data.ts`). The page polls every 2.5s — no build step.

## 0.3.0

### State-of-the-art autonomy: verified, self-healing, parallel

A multi-agent SOTA audit (vs Devin, OpenHands, SWE-agent, AutoGen, MetaGPT) found the 0.2 loop shipped self-declared "done" with no independent check, ran serially, and stranded failures. 0.3 closes that gap — the team now produces **verified, self-healing, parallel** work.

- **Independent critic review** — a reviewer SME (different provider than the implementer) reviews the actual `git diff` against acceptance criteria and returns accept/reject. Replaces the old auto-accept. Rejections go back to the implementer with the reasons.
- **Repair / retry loop** — failed tasks are re-dispatched with the captured error injected into the prompt ("previous attempt failed: …; don't repeat it"), up to `maxRepairs`, then escalated to a human instead of stranded.
- **Git checkpoint + revert-on-regression** — HEAD is snapshotted before each task; a change that turns a green suite red is reverted, never inherited by the next task.
- **Reward-hacking guard** — test/CI files are hashed before and after; an agent that edits its own grader to pass is hard-blocked.
- **Real coordination** — each SME now receives an inbox (messages addressed to it) and its upstream dependencies' results, so `dependsOn` carries artifacts, not just ordering.
- **Git-worktree isolation + true parallelism** — each role works on its own branch in an isolated worktree, so SMEs run **concurrently** (`maxParallel`) without clobbering each other; accepted work is merged back to main through the critic gate.
- **Cost ledger + budget gate** — per-task spend is parsed from agent output into `.loop/board/costs.jsonl`; the run stops at `budgetUsd`.

New loop config: `reviewer`, `maxRepairs`, `maxParallel`, `isolate`, `budgetUsd`. New status `escalated`.

## 0.2.0

### Autonomous SME team

Loop Orchestrator goes from one-shot tmux prompting to an **autonomous multi-agent engineering team** that drives Claude Code, Codex, and Gemini CLI as project-trained subject-matter experts.

**New commands**

- `loop learn` — scans the repo and writes `PROJECT-INTELLIGENCE.md` (stack, frameworks, layout, and the real test/build/lint commands), injected into every agent prompt so the team is "trained" on your codebase.
- `loop run "<goal>"` — a planner agent decomposes the goal into assigned tasks on a shared blackboard, then the autonomy loop dispatches each task to the right SME, detects completion from exit code + structured output, and gates "done" on the project's test command. Dry-run by default; `--execute` launches the agents.
- `loop monitor` — single-screen mission control: the board plus a live tail of every agent's tmux pane.
- `loop roles` — list the 27 built-in SME disciplines.

**New capabilities**

- **27-discipline SME role library** (architect, PM, frontend, backend, full-stack, QA, CT/test-automation, devops, SRE, security, DBA, performance, accessibility, mobile, data, ML, and more), each with a deep system prompt and a best-fit provider. Set `sme: <discipline>` on a role to inherit the expert prompt.
- **Shared blackboard** — append-only JSONL (`.loop/board/`) with first-claim-wins coordination and `dependsOn` task gating.
- **Headless per-task execution** — tmux is the human viewport (tiled panes); control flow spawns a fresh headless `claude -p` / `codex exec` / `gemini -p` child per task for reliable completion detection.
- **Web dashboard** now includes a `/api/board` endpoint and a Board view.

**Config additions**

- `role.sme`, `project.intelligence`, and `loop.orchestrator` / `loop.idleSeconds` / `loop.pollSeconds`.
- `loop init` now scaffolds a validated 7-SME team.

## 0.1.3

- Initial public release: tmux-based role sessions, per-role provider/model selection, project briefs, prompt-only and execute modes, local dashboard, provider auth detection.
