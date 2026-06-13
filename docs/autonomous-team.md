# Autonomous Team

Stand up a full software org of headless AI experts, point them at a goal, and watch
the whole team work on one screen. Three commands:

```bash
loop learn                 # train the team on your codebase
loop run "<goal>"          # decompose the goal and drive the autonomy loop
loop monitor               # single-screen mission control
```

`loop learn` scans the project and writes a `PROJECT-INTELLIGENCE.md` that grounds every
expert. `loop run` decomposes your goal into board tasks, fields the subject-matter
experts (SMEs) your config asks for, and runs each task as a headless agent inside its
own tmux pane. `loop monitor` redraws the shared blackboard plus a live tail of every
agent pane in place, so you never attach to tmux or juggle windows.

---

## 60-second quickstart

```bash
# 1. Scaffold a config + brief in the current repo
loop init

# 2. Train the team on this codebase -> writes PROJECT-INTELLIGENCE.md
loop learn

# 3. Decompose a goal and drive the board (safe dry-run by default)
loop run "Add a dark-mode toggle to the settings page"

# 4. In another terminal, watch the whole team on one screen
loop monitor

# 5. When you're ready to actually spend tokens / launch agent CLIs:
loop run "Add a dark-mode toggle to the settings page" --execute
```

By default `loop run` is a **safe dry-run**: it decomposes the goal, writes role prompts,
and drives the board forward (claim -> needs-review -> accepted) *without* launching any
agent CLI or spending tokens. Pass `--execute` to actually run the headless agents and the
verification gate. This lets you inspect the plan and the monitor before committing spend.

---

## How project intelligence trains the team

`loop learn` runs the scanner in `src/intelligence.ts` against your working directory and
writes a compact `PROJECT-INTELLIGENCE.md` (path configurable via `project.intelligence`,
default `PROJECT-INTELLIGENCE.md`). That file is injected into **every** SME's system
prompt, so a frontend, backend, or QA expert never has to re-discover the stack, the
directory layout, or — most importantly — the real build/test/lint commands.

It detects:

- **Languages** — by source-file extension counts (TypeScript, JavaScript, Python, Go,
  Rust, Ruby, Java, Kotlin, PHP, C#, Swift, Vue, Svelte; top 5 by frequency).
- **Frameworks / tools** — from `package.json` deps (Next.js, React, Vue, Svelte, Angular,
  Express, Fastify, NestJS, Vitest, Jest, Playwright, Tailwind, Prisma, Drizzle) and from
  marker files (`go.mod`, `Cargo.toml`, `requirements.txt`/`pyproject.toml`, `Dockerfile`).
- **Package manager** — from the lockfile (`pnpm` / `yarn` / `bun` / `npm`).
- **Commands** — `install`, `build`, `test`, `lint`, `typecheck`, `dev`, derived from
  `package.json` scripts (or `go test ./...`, `cargo test`, `pytest`, `make` targets for
  non-JS projects). These are read from the manifest rather than letting agents *invent*
  them, which is the single biggest source of wasted autonomous loops.
- **Entrypoints** — `package.json` `main`/`bin` plus common candidates (`src/index.ts`,
  `src/main.ts`, `src/cli.ts`, `main.go`, `app.py`, ...).
- **Top-level dirs** — ignoring `node_modules`, `dist`, `.git`, `.loop`, etc.
- **Git** — current branch and `origin` remote, when available.

The rendered file tells every agent to treat the detected commands as the source of truth
and **not** to invent build/test commands.

`loop run` regenerates intelligence automatically before planning, so you do not strictly
have to run `loop learn` first — but doing so lets you review what the team learned and
re-run it after a big stack change.

---

## The SME role library

The library lives in `src/sme.ts` as `SME_LIBRARY` — 27 deep, project-aware role
definitions. Each role has an `identity`, a numbered `operatingLoop`, a verifiable
`definitionOfDone`, discipline-specific `guardrails`, and a `preferredProvider`.

A role becomes an SME by setting `sme: <discipline>` in your config (see the example
below). The prompt builder then composes `identity + operatingLoop + definitionOfDone +
guardrails` together with the injected `PROJECT-INTELLIGENCE.md` and the shared-board
protocol to produce the system prompt that role's headless agent runs under. An unknown
discipline falls back to the generic `engineer`.

`preferredProvider` is only a **type hint** (`claude` / `codex` / `gemini`) the team
builder uses to pick a sensible default model. It is always overridable — the actual
provider a role uses is whatever its `provider:` key points at in your config.

List the disciplines at any time:

```bash
loop roles            # prints all 27 discipline keys
```

### Disciplines and preferred providers

| Discipline | Title | Preferred provider |
|---|---|---|
| `architect` | Architect / CTO | claude |
| `product-manager` | Product Manager | claude |
| `engineering-manager` | Engineering Manager | claude |
| `ux-designer` | UX Designer | claude |
| `frontend` | Frontend Engineer | claude |
| `backend` | Backend Engineer | codex |
| `fullstack` | Full-stack Engineer | codex |
| `mobile` | Mobile Engineer | codex |
| `data-engineer` | Data Engineer | codex |
| `ml-engineer` | ML / AI Engineer | claude |
| `integration-engineer` | Integration Engineer | codex |
| `qa` | QA Engineer | claude |
| `ct` | CT / Test Automation Engineer | codex |
| `sre` | Site Reliability Engineer | gemini |
| `performance-engineer` | Performance Engineer | codex |
| `accessibility` | Accessibility Specialist | claude |
| `security` | Security Engineer | claude |
| `devops` | DevOps Engineer | gemini |
| `platform-engineer` | Platform Engineer | gemini |
| `dba` | Database Administrator | codex |
| `release-manager` | Release Manager | gemini |
| `refactorer` | Refactoring / Tech-Debt Engineer | codex |
| `code-reviewer` | Code Reviewer | claude |
| `technical-writer` | Technical Writer | gemini |
| `i18n` | Internationalization Engineer | gemini |
| `observability` | Observability Engineer | gemini |
| `engineer` | Software Engineer (generic fallback) | claude |

Roughly: **claude** leads on design, product, review, and judgment-heavy work
(architecture, PM, EM, UX, frontend, ML, QA, a11y, security, code review); **codex** on
implementation-heavy engineering (backend, fullstack, mobile, data, integration, test
automation, perf, DBA, refactoring); **gemini** on ops, platform, and writing (SRE,
DevOps, platform, release, docs, i18n, observability).

### The default team

`DEFAULT_TEAM` is a lean but complete delivery unit covering plan -> build -> test ->
review -> ship:

```
product-manager, architect, frontend, backend, qa, ct, security
```

The orchestrator can field more specialists on demand; this is the sensible start.

---

## The shared blackboard

All coordination flows through an append-only **blackboard** (`src/board.ts`) under
`.loop/runs/<run-id>/board/`, in three JSONL logs:

- `tasks.jsonl` — work items the orchestrator/PM decomposes the goal into.
- `events.jsonl` — status updates SMEs emit (`claimed` / `in-progress` / `needs-review` /
  `blocked` / `done` / `rejected`).
- `messages.jsonl` — free-form hand-off notes between roles.

Append-only JSONL is the safest cross-process format with tmux as the only IPC: every
writer only ever appends a single line (`O_APPEND`), so concurrent single-line writes do
not interleave on local filesystems. History is never rewritten — the **current state of a
task is the reduction (fold) of its event stream**.

### How status is folded

`foldBoard(dir)` replays the event log over the tasks to produce a `TaskView[]`
(sorted by descending priority):

1. Every task starts `open`.
2. The **first** `claimed` event wins the claim — later claims for the same task are
   ignored, so two agents never both "own" a task without a lock.
3. After a claim, later events advance the status; `done` / `rejected` / `blocked` from
   anyone are honored (the PM can reject, QA can block).

Helpers built on the fold:

- `openTasksFor(dir, role)` — open, unclaimed tasks assigned to a role (what an SME picks
  up next).
- `isComplete(dir)` — true once **every** task is `done` or `rejected` (the run's stop
  condition).
- `boardSummary(dir)` — totals plus a count by status, used by the monitor.
- `compactBoard(dir)` — folds and rewrites a minimal event stream so the log does not grow
  unbounded across long runs. Guarded by an advisory lock; only the orchestrator calls it,
  never SMEs.

Tasks carry `assignee` (the SME role key), `createdBy`, `acceptanceCriteria`, `dependsOn`,
and `priority`. A task is only dispatched once **all its `dependsOn` tasks are `done`**, so
the architect can sequence work and the loop respects it.

---

## Headless per-task execution

Each iteration, for every SME role, the autonomy loop (`src/orchestrator.ts`) picks that
role's highest-priority, dependency-satisfied open task and dispatches it as a **headless
agent child**. The key idea:

> **tmux is the viewport, not the runtime.** The headless child is the source of truth;
> the pane just mirrors a tail of its output so a human can watch.

The lifecycle of one task dispatch:

1. **Claim** — append a `claimed` event for `(role, taskId)`.
2. **Run headless** — spawn the provider's headless command (built per provider type) with
   the task text + acceptance criteria, in the project working dir. A trimmed tail of
   stdout is mirrored into the role's tmux pane via `tmux display-message` (non-destructive
   — it never interferes with the running viewport).
3. **Detect completion** — the child is considered successful only when it **exits 0 AND
   produces structured output** (a `"result"` payload, `"is_error":false`, or any non-empty
   stdout). A per-task timeout (the loop's `cadenceMinutes`) kills runaways.
4. **Verification gate** — if the agent succeeded *and* a verify command exists, the loop
   runs the **project's own test command** (falling back to build) — re-derived from the
   live project intelligence, so it is authoritative, not guessed. The verify runs through
   the shell with its own timeout.
5. **Emit outcome** — append `needs-review` if implementation **and** verification passed,
   otherwise `blocked` (with a summary saying whether the agent exited non-zero or
   verification failed). Completion therefore requires **exit code + structured output +
   the verification gate** to all line up.

After dispatching across all roles in an iteration, the orchestrator runs a **review pass**
(the role named by `loop.orchestrator`, default `pm`): it accepts `needs-review` tasks and
marks them `done` so the board converges. (A real PM-agent prompt can replace this with
criteria-based accept/reject.)

The loop stops when `isComplete()` is true (all tasks `done`/`rejected`), when no task was
dispatched (nothing left to do), or at `loop.maxIterations`. Between iterations it sleeps
`loop.pollSeconds`. In dry-run (no `--execute`), each task is simply claimed and marked
`needs-review` so the board still advances and the monitor is fully observable without
spend.

---

## The single-screen monitor

`loop monitor` (`src/monitor.ts`) is unified terminal mission control: it renders the
**whole team on one screen** and redraws in place on an interval (default 1500ms; override
with `--interval <ms>`). Use `--once` for a single frame (CI / piping).

A frame has three sections:

- **Header** — session name, total task count, and a colored glyph tally by status.
- **BOARD** — one row per task: status glyph, id, title, `-> assignee`, status, and the
  last summary. Rows are colored by status (grey `open`, cyan `claimed`, blue
  `in-progress`, yellow `needs-review`, red `blocked`, green `done`, magenta `rejected`).
- **AGENTS** — for each role, a live tail of its tmux pane (`capturePaneById`), with the
  per-agent line budget split across the remaining terminal height. Idle panes show
  `…idle…`.

The monitor discovers panes for the run's session automatically (`discoverPanes`, role
inferred from the pane title), so you only pass `--run <id>`. It needs no write access to
the board — it is a pure read view that polls `boardSummary` plus the panes.

```bash
loop monitor --run <run-id>          # live, redraws in place; Ctrl-C to exit
loop monitor --run <run-id> --once   # one frame, then exit
```

---

## Example `loop.config.yaml` using `sme:` roles

This wires real disciplines from the SME library to provider keys. Each role's expert
system prompt is seeded from `SME_LIBRARY[<sme>]`; the `provider:` key decides which CLI /
model actually runs it (overriding the discipline's `preferredProvider` hint).

```yaml
version: 1
defaults:
  namespace: loop
  runDir: .loop/runs

projects:
  - name: web-app
    brief: brief.md
    workingDir: .
    intelligence: PROJECT-INTELLIGENCE.md   # loop learn writes here
    safetyMode: workspace-write
    providers:
      anthropic:
        type: claude
        model: claude-opus-4-8
        auth: { mode: auto }
        dangerouslySkipPermissions: true
        promptMode: stdin
      openai:
        type: codex
        model: gpt-5.4
        effort: medium
        auth: { mode: auto }
        yolo: true
        promptMode: stdin
      google:
        type: gemini
        model: gemini-3.5-flash
        auth: { mode: auto }
        promptMode: stdin
    roles:
      - name: pm
        title: Product Manager
        sme: product-manager      # seeds the PM expert prompt
        provider: anthropic
      - name: arch
        title: Architect
        sme: architect
        provider: anthropic
      - name: fe
        title: Frontend Engineer
        sme: frontend
        provider: anthropic
      - name: be
        title: Backend Engineer
        sme: backend              # prefers codex -> openai provider
        provider: openai
      - name: qa
        title: QA Engineer
        sme: qa
        provider: anthropic
      - name: tests
        title: Test Automation
        sme: ct
        provider: openai
      - name: sec
        title: Security
        sme: security
        provider: anthropic
    loops:
      - name: delivery-loop
        cadenceMinutes: 30        # also the per-task headless timeout
        maxIterations: 8
        pollSeconds: 8            # sleep between iterations
        idleSeconds: 20           # output quiescence before a pane's turn ends
        orchestrator: pm          # role that decomposes the goal + runs review
        stopWhen:
          - all tasks done
```

Run it:

```bash
loop learn
loop run "Build a settings page with profile editing and email notifications" --execute
loop monitor   # in a second terminal
```

The `orchestrator` role (`pm`) decomposes the goal into board tasks (assigning each to one
of the other roles by key), every other role runs its tasks headless under its SME prompt,
the project's test command gates each completion, and you watch all of it on one screen.

### Config field reference

| Field | Purpose |
|---|---|
| `project.intelligence` | Path `loop learn` writes (and `loop run` regenerates) PROJECT-INTELLIGENCE.md to. |
| `role.sme` | SME discipline that seeds this role's expert system prompt. Optional; omit for a hand-written role. |
| `role.provider` | Provider key this role's agent runs under — overrides the discipline's `preferredProvider`. |
| `loop.orchestrator` | Role that decomposes the goal and runs the review pass (default `pm`). |
| `loop.maxIterations` | Hard cap on autonomy-loop iterations. |
| `loop.cadenceMinutes` | Per-task headless timeout (a runaway agent is killed after this). |
| `loop.pollSeconds` | Sleep between iterations. |
| `loop.idleSeconds` | Output quiescence before a pane's turn is considered finished. |

---

## See also

- `docs/configuration.md` — providers, auth modes, repositories, roles.
- `docs/architecture.md` — how the pieces fit together.
- `docs/safety.md` — safety modes and execution switches.
