# GOAL.md — Working Prompt for Claude

> **Read this first, then work.** This file is the standing mission brief for any
> AI agent (Claude Code, Codex, Gemini, or a human) picking up work on
> **Loop Orchestrator**. It tells you what the project is, where it stands today,
> what "best in the world" means here, and exactly which features to build next —
> with priorities, rationale, and acceptance criteria you can verify.
>
> Treat the **Next Features** section as a backlog ordered by impact. Pull the
> top unblocked item, ship it as a small reviewable PR, then come back here.

---

## 1. Mission

Make Loop Orchestrator the **best open-source way to run a persistent, multi-agent
AI software-engineering team in tmux** — across Claude Code, Codex, Gemini CLI, and
custom terminal agents.

"Best in the world" is not measured in lines of code or features shipped. It is
measured by these outcomes:

1. **Time-to-first-team < 5 minutes.** A new user goes from `npm i -g` to a running,
   correctly-authenticated team in under five minutes, with zero edits to TypeScript.
2. **It actually loops.** The product's namesake — autonomous iteration with a
   cadence, an iteration cap, and real stop conditions — works end to end.
3. **Trustworthy by default.** Safe (prompt-only) mode is the default; every unsafe
   switch is explicit, logged, and scoped. No surprises, no silent destructive runs.
4. **Observable.** You can always answer "what is each agent doing right now, what
   has it done, and what did it cost?" from one dashboard.
5. **Provider-agnostic.** Adding a new agent CLI is config, not a code fork.
6. **Boringly reliable.** Crashes are detected and surfaced; restarts are one command;
   nothing is lost when a laptop disconnects.

If a proposed change does not move at least one of these six outcomes, it is probably
not the next thing to build.

---

## 2. What this project is (current state)

Loop Orchestrator is a small, dependency-light Node.js + TypeScript CLI. It does **not**
embed provider SDKs — it drives already-authenticated terminal agents inside tmux.

**Code map (read these before changing behavior):**

| Area | File | Responsibility |
| --- | --- | --- |
| CLI entry | `src/cli.ts` | Commander setup, all subcommands, `init` scaffolding |
| Config schema | `src/config/schema.ts` | Zod schema: providers, repositories, roles, loops |
| Config load | `src/config/load.ts` | Locate + parse + validate `loop.config.yaml` |
| Prompt builder | `src/prompts.ts` | Per-role run prompt (`buildRolePrompt`) |
| Providers | `src/providers.ts` | Turn provider config into a shell command + flags |
| tmux control | `src/tmux.ts` | Session naming, start/stop, capture-pane, list |
| Auth detect | `src/auth.ts` | Detect local CLIs / API-key env vars |
| Dashboard | `src/dashboard/server.ts` | Local HTTP server: status, logs, config |
| Tests | `tests/*.test.ts` | vitest unit tests (config, prompts, providers, tmux, auth) |

**Commands that exist today:** `init`, `validate`, `auth status`, `auth configure`,
`start`, `status`, `logs`, `stop`, `dashboard`.

**Stack & conventions:**
- ESM (`"type": "module"`), Node ≥ 20, TypeScript strict, Zod for validation.
- Dependencies are intentionally minimal: `commander`, `yaml`, `zod`. **Do not add
  heavy dependencies without strong justification** — every dep is a setup-time cost.
- Tests use `vitest`. `npm run validate` = typecheck + test + build. It must stay green.
- The tool **never edits user repos itself**; the agents it launches do. Preserve that
  safety boundary.

---

## 3. Known gaps the current code reveals

These are not speculation — they are visible in the code today:

1. **Loops never run.** `LoopSchema` (`cadenceMinutes`, `maxIterations`, `stopWhen`) is
   parsed and stored but **nothing executes it**. The core promise of the product is
   unfulfilled. *(See Feature A — highest priority.)*
2. **`loop attach` is dangling.** `src/tmux.ts:112` tells the user to "Run: `loop attach
   <session>`", but `cli.ts` has no `attach` command. *(See Feature C.)*
3. **No stop-condition detection.** `stopWhen` is free-text with no evaluator.
4. **No run metadata / history.** `runDir` is created but no manifest of what ran,
   when, with which provider/model, or its result is persisted.
5. **No crash/health detection.** If an agent CLI exits or errors, nothing notices.
6. **No way to send input to a running agent** (e.g. "address review feedback").
7. **Dashboard is static.** No auto-refresh, no run grouping, no live tail.
8. **No environment doctor.** Missing tmux / missing provider only fails at start time.
9. **Validation is shallow.** It does not assert that every role's `provider` exists or
   that every role repository is declared in `repositories`.
10. **No cost/usage signal.** Outcome #6 ("what did it cost?") has no data source yet.

---

## 4. Operating rules for the agent doing this work

1. **Smallest robust change.** One feature → one focused PR. Don't bundle Feature A and
   Feature E together.
2. **Stay on the assigned branch.** Develop on the branch you were told to use; never
   push to `main` without explicit permission. Open a PR only when asked.
3. **Tests are part of the feature.** Every new command or behavior ships with vitest
   coverage. `npm run validate` must pass before you report done.
4. **No new heavy deps** without justifying the setup-cost tradeoff in the PR body.
5. **Preserve the safety boundary.** Default to safe/prompt-only. New unsafe behavior
   must be opt-in, explicit in config or flags, and surfaced in output.
6. **Update docs with code.** If you add a command or config field, update `README.md`,
   the relevant file under `docs/`, and the `init` scaffolding in `cli.ts`.
7. **Backward compatible.** Existing `loop.config.yaml` files must keep working. New
   schema fields get sane defaults via Zod.
8. **Verify, then claim.** Run the command you built. Paste real output in the PR. If a
   step was skipped or a test fails, say so plainly.

---

## 5. Next Features (the backlog, ordered by impact)

Each feature below has: **why it matters** (which mission outcome), a **sketch** of the
approach, and **acceptance criteria** you can check. Build them roughly top-to-bottom;
respect the dependency notes.

> **Shipped so far:** An initial **dynamic workflow engine** now covers the core of
> Features A, B, and D — `loop run --workflow <name>` launches stages as their
> dependencies complete, evaluates stop-conditions each tick, and writes a per-run
> manifest. See `docs/workflows.md`. Remaining polish on those features (resume,
> richer manifest history commands, GitHub-backed signals) is still open below.

### Feature A — The loop runner (make the namesake real) 🔴 highest priority

**Why:** Mission outcome #2. The product is called *Loop* Orchestrator but does not loop.
This is the single biggest gap between the promise and the product.

**Sketch:**
- Add `loop run --loop <name> [--run <id>] [--execute]` (or extend `start`) that, for a
  named loop, iterates up to `maxIterations`, waking every `cadenceMinutes`.
- On each iteration: capture each role session's recent pane output, evaluate the loop's
  `stopWhen` conditions (Feature B), and stop early when satisfied.
- Persist iteration state to the run manifest (Feature D) so a loop can resume.
- Must be cancellable (Ctrl-C / `loop stop`) and must never busy-wait.

**Acceptance criteria:**
- [ ] `loop run --loop delivery-loop` starts the configured roles and iterates on cadence.
- [ ] It stops at `maxIterations` if no stop condition fires, and stops early if one does.
- [ ] Iteration count, timestamps, and stop reason are written to the run manifest.
- [ ] Unit tests cover: cadence math, max-iteration cap, early-stop, and cancellation.
- [ ] No fixed `sleep` busy-loops; uses timers and is interruptible.

### Feature B — Stop-condition evaluator 🔴 (unblocks A)

**Why:** Outcome #2 + #3. `stopWhen` is meaningless without an evaluator.

**Sketch:**
- Define a small, documented vocabulary of conditions instead of free text, e.g.
  `tests-pass`, `pr-opened`, `pane-idle:<minutes>`, `pane-matches:<regex>`,
  `review-approved`. Keep raw-string conditions as a `pane-matches` fallback for compat.
- Evaluate against captured pane output and (later) GitHub state (Feature G).
- Return a structured result: which condition matched, on which role, with the evidence.

**Acceptance criteria:**
- [ ] Each condition type has a pure, unit-tested evaluator function.
- [ ] Existing free-text `stopWhen` entries still validate and behave as `pane-matches`.
- [ ] The evaluator returns the matched condition + evidence, not just a boolean.
- [ ] Documented in `docs/configuration.md` with examples.

### Feature C — `loop attach` (close the dangling reference) 🟠 quick win

**Why:** Outcome #4. The code already advertises this command; it just isn't wired up.
Low effort, removes a visible broken promise.

**Sketch:** Add `loop attach <session>` that execs `tmux attach -t <session>`, with a
clear error if the session does not exist (list available sessions in the message).

**Acceptance criteria:**
- [ ] `loop attach <session>` attaches to a live session.
- [ ] Attaching to a missing session prints a helpful error listing live sessions.
- [ ] The hint string in `tmux.ts` now points at a command that exists.
- [ ] Covered by a unit test (mock the tmux invocation).

### Feature D — Run manifest & history 🟠 (unblocks A, F, J)

**Why:** Outcomes #4 & #6. Today a run leaves prompt files but no record of *what* ran.

**Sketch:**
- Write `.loop/runs/<run-id>/run.json` capturing: run id, project, start time, each role
  with its provider/model/safety flags, session name, and per-iteration status/stop reason.
- Add `loop runs` (list past runs) and `loop show <run-id>` (print a manifest summary).
- Update it incrementally as the loop runs, not just at the end.

**Acceptance criteria:**
- [ ] `start`/`run` write a `run.json` manifest with the fields above.
- [ ] `loop runs` lists prior runs newest-first; `loop show <id>` prints a summary.
- [ ] Manifest is valid against a Zod schema and round-trips in tests.

### Feature E — `loop doctor` (preflight environment check) 🟠 quick win

**Why:** Outcome #1. Catch "tmux not installed" / "claude not on PATH" *before* a run,
with actionable fixes — not as a cryptic mid-start failure.

**Sketch:** A command that checks: tmux present + version; each configured provider's
command resolvable on PATH; auth detected per provider (reuse `auth.ts`); config valid.
Print a checklist with ✅/❌ and a one-line fix for each ❌. Support `--json`.

**Acceptance criteria:**
- [ ] `loop doctor` reports tmux, per-provider CLI presence, and auth status.
- [ ] Each failure includes a concrete remediation line.
- [ ] Exit code is non-zero when a required check fails; `--json` mirrors the human output.
- [ ] Unit-tested with mocked environment probes.

### Feature F — Deeper config validation 🟢

**Why:** Outcome #1. Fail fast and friendly. Today a role can reference a provider or
repository that does not exist and you only find out at runtime.

**Sketch:** In `loadConfig` (or a dedicated validate pass): assert every `role.provider`
exists in `providers`; every `role.repositories[*]` exists in `repositories`; every
`loop` referenced by a command exists; warn on unused providers/repos. Aggregate all
errors and report them together with the offending path.

**Acceptance criteria:**
- [ ] `loop validate` reports *all* reference errors at once, each with a clear location.
- [ ] Valid configs are unaffected; the existing examples still pass.
- [ ] Each new check has a failing-case unit test.

### Feature G — GitHub awareness for stop conditions 🟢 (depends on B, D)

**Why:** Outcomes #2 & #3. `pr-opened` / `review-approved` are the most useful stop
conditions for real delivery loops, but need a source of truth beyond pane scraping.

**Sketch:** Optional, opt-in. Shell out to the user's existing `gh` CLI (do **not** add an
API-key dependency) to check whether a PR exists for the run's branch and its review
state. Degrade gracefully (and say so) when `gh` is absent.

**Acceptance criteria:**
- [ ] `pr-opened` and `review-approved` conditions resolve via `gh` when available.
- [ ] Absence of `gh` produces a clear "skipped: gh not found" note, not a crash.
- [ ] The GitHub probe is isolated behind one module and unit-tested with a mock.

### Feature H — Send input to a running agent 🟢

**Why:** Outcome #4. Mid-run you often need to nudge an agent ("address QA feedback")
without killing and restarting it.

**Sketch:** `loop send <session> <message>` using `tmux send-keys`. Optionally
`loop send --role <name> --run <id>` to resolve the session for you. Quote/escape safely.

**Acceptance criteria:**
- [ ] `loop send` injects a line into the target session's input.
- [ ] Role+run resolution maps to the correct session name.
- [ ] Shell-escaping is covered by a unit test (no injection via message contents).

### Feature I — Live dashboard 🟢

**Why:** Outcome #4. The dashboard is the "what is happening" surface and is currently
static and ungrouped.

**Sketch:** Auto-refresh status; group sessions by run; live-tail a session (poll
`/api/logs`, or stream via SSE — but only if it stays dependency-free); show each role's
provider/model from the manifest. Keep it a single self-contained HTML page (no build step).

**Acceptance criteria:**
- [ ] Sessions are grouped by run with role/provider/model shown.
- [ ] Status auto-refreshes without a manual button click.
- [ ] At least one session's logs can be live-tailed.
- [ ] No new runtime dependency and no separate frontend build.

### Feature J — Crash detection & restart 🟢 (depends on D)

**Why:** Outcome #6. Long overnight runs must not silently die.

**Sketch:** Detect when a session's agent process has exited unexpectedly (pane dead /
session gone while the loop expects it alive). Surface it in `status`, the dashboard, and
the manifest. Add `loop restart --run <id> [--role ...]` to relaunch affected roles.

**Acceptance criteria:**
- [ ] A dead session is reported as `crashed`/`exited`, distinct from `running`.
- [ ] `loop restart` relaunches only the affected role(s) and updates the manifest.
- [ ] Detection logic is unit-tested against mocked tmux state.

### Feature K — Custom prompt templates 🔵 stretch

**Why:** Outcome #5. `buildRolePrompt` is hard-coded; power users want their own house
style and role playbooks without editing TypeScript.

**Sketch:** Allow an optional `promptTemplate` path per role/project with a tiny,
dependency-free token substitution (`{{brief}}`, `{{role}}`, `{{repositories}}`, etc.).
Fall back to the built-in template when none is provided.

**Acceptance criteria:**
- [ ] A configured template overrides the default; missing template = current behavior.
- [ ] Unknown tokens are reported, not silently dropped.
- [ ] Token substitution is unit-tested.

### Feature L — Cost & usage signal 🔵 stretch (depends on D)

**Why:** Outcome #6. "What did it cost?" needs a data source. This is exploratory.

**Sketch:** Where a provider CLI can emit token/cost info, capture and aggregate it into
the manifest per role/run. Where it can't, record wall-clock and iteration counts as a
proxy. Display in `loop show` and the dashboard. Keep expectations honest — partial data
is fine, fabricated data is not.

**Acceptance criteria:**
- [ ] Manifest gains an optional usage block (tokens/cost when available, else duration).
- [ ] `loop show` surfaces whatever usage data exists, clearly labeled as partial.

---

## 6. Suggested sequencing

```
C  (attach)      ─┐  quick wins, ship first for momentum
E  (doctor)      ─┤
F  (validation)  ─┘
D  (manifest)    ──► unblocks A, F, J, L
B  (stop-eval)   ──► unblocks A, G
A  (loop runner) ◄── the headline feature; needs B + D
G  (github)      ◄── needs B + D
H  (send)        ─┐  independent improvements
I  (dashboard)   ─┤
J  (restart)     ─┘  needs D
K  (templates)   ─┐  stretch
L  (cost)        ─┘  stretch, needs D
```

Ship the three quick wins (C, E, F) first to build momentum and tighten the
new-user experience, then land D and B as the foundation for the headline
loop runner (A). Everything else layers on top.

---

## 7. Definition of done (every PR)

- [ ] `npm run validate` passes (typecheck + tests + build).
- [ ] New behavior has unit tests; the failing case is tested, not just the happy path.
- [ ] `README.md`, the relevant `docs/*.md`, and `init` scaffolding updated if needed.
- [ ] Backward compatible — existing configs and the bundled examples still work.
- [ ] Safety boundary intact — defaults safe, unsafe is explicit and surfaced.
- [ ] PR body shows real command output proving the feature works.

---

## 8. What "best in the world" looks like when we're done

A developer installs Loop Orchestrator, runs `loop doctor` and fixes whatever it flags,
runs `loop init`, points it at two repos, and starts a delivery loop. The team of agents
plans, implements, tests, and opens PRs — iterating on a cadence and stopping cleanly when
tests pass and a PR is open. The developer watches it live in the dashboard, nudges an
agent when needed, and finds a complete, auditable record of every run — including what it
cost — the next morning. Nothing crashed silently. Nothing destructive happened without an
explicit switch. Adding a new agent CLI took three lines of YAML.

That is the bar. Build toward it one small, verifiable PR at a time.
