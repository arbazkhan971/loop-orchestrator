# Loop Orchestrator

Configurable tmux-based AI engineering teams for Claude Code, Codex, Gemini CLI, and any terminal agent.

Loop Orchestrator helps you run a persistent AI team inside tmux: planners, frontend engineers, backend engineers, QA reviewers, scouts, and release leads. Each role gets a project brief, assigned repositories, model/provider settings, safety rules, and a repeatable operating loop.

## Why This Exists

Most agent workflows are either one-off prompts or hard-coded scripts. Loop Orchestrator gives you a portable repo-level control plane:

- Role-based tmux sessions for long-running agents
- Per-role provider and model selection
- First-class unsafe-mode switches for tools that support them
- Project briefs, repo scope, and guardrails
- Prompt-only mode for safe setup, execute mode for launching agents
- Local dashboard for session status and logs
- Generic YAML config that works across teams and projects

## Keywords

AI agents, agent orchestrator, tmux, Claude Code, Codex, Gemini CLI, multi-agent coding, agentic coding, autonomous software engineering agents, terminal agents, workflow automation, GitHub automation, AI devtools.

## Install

```bash
npm install -g loop-orchestrator
```

For local development:

```bash
npm install
npm run build
npm link
```

## Quick Start

```bash
mkdir my-ai-team
cd my-ai-team
loop init
loop validate
loop start --run issue-123
tmux ls
loop dashboard
```

By default, `loop start` creates tmux shells with prompt files. This is intentionally safe. To launch configured agent commands:

```bash
loop start --run issue-123 --execute
```

## Core Commands

```bash
loop init                 # create loop.config.yaml and brief.md
loop validate             # validate config
loop start --run bug-42   # start role sessions in tmux
loop status               # list loop sessions
loop logs <session>       # capture recent tmux pane output
loop stop bug-42          # kill sessions for a run
loop dashboard            # open local web dashboard
```

## Example Roles

Provider flags can be configured without raw argument strings:

```yaml
providers:
  frontend:
    type: claude
    model: claude-sonnet-4-6
    dangerouslySkipPermissions: true
  backend:
    type: codex
    model: gpt-5.4
    effort: medium
    yolo: true
```

```yaml
roles:
  - name: cto
    title: Technical lead and architecture reviewer
    provider: planner
    repositories: [frontend-app, backend-api]
  - name: fe1
    title: Frontend engineer
    provider: frontend
    repositories: [frontend-app]
  - name: be1
    title: Backend engineer
    provider: backend
    repositories: [backend-api]
  - name: qa1
    title: QA and release reviewer
    provider: backend
    repositories: [frontend-app, backend-api]
```

## Safety Model

Loop Orchestrator never edits your repositories by itself. It creates tmux sessions and role prompts. The agents you configure do the work, so your safety posture depends on provider flags and local permissions.

Recommended defaults:

- Use prompt-only mode until the team config is correct.
- Assign narrow repository scopes per role.
- Enable `dangerouslySkipPermissions` or `yolo` only for disposable worktrees or trusted environments.
- Keep production branches protected.
- Require tests before release review.
- Avoid destructive database commands in all prompts.

## Dashboard

```bash
loop dashboard --port 4318
```

The dashboard shows active sessions and lets you inspect recent tmux output from the browser.

## License

MIT
