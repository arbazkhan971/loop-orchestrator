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

## Prerequisites

Install the tools you want Loop Orchestrator to control:

```bash
# Required
brew install tmux

# Optional providers. Install and log in to whichever ones you use.
claude
codex
gemini
```

You can use subscription/OAuth CLI login or API keys. Loop Orchestrator detects local CLI state and API-key env vars, but it never stores secret values in config.

## Install

```bash
npm install -g loop-orchestrator
loop --version
```

For local development:

```bash
npm install
npm run build
npm link
```

## Step-by-Step Setup

### 1. Open Your Project

Run Loop Orchestrator from the repo or workspace where you want the team config to live.

```bash
cd /path/to/your/repo
```

For a full-stack setup, you can also create one orchestration folder and point it at multiple repos:

```bash
mkdir ai-team
cd ai-team
```

### 2. Initialize Config

```bash
loop init
```

This creates:

- `loop.config.yaml`: providers, repositories, roles, and loops
- `brief.md`: project brief sent to every role
- `.loop/`: generated prompts and run metadata

### 3. Detect Local Provider Auth

```bash
loop auth status
loop auth configure --write
```

This checks your machine for:

- `claude`
- `codex`
- `gemini`
- `agy`
- API env vars such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`

It writes auth metadata into `loop.config.yaml`, for example:

```yaml
providers:
  frontend:
    type: claude
    command: claude
    auth:
      mode: subscription
      configured: true
```

### 4. Edit Your Project Brief

Open `brief.md` and describe the product, coding rules, test expectations, release rules, and any hard constraints.

Example:

```markdown
# Project Brief

Build changes in small PRs.
Use worktrees for parallel tasks.
Run tests before reporting completion.
Do not run destructive database commands.
```

### 5. Configure Repositories

Edit `loop.config.yaml` and point repositories to real local paths:

```yaml
repositories:
  - name: frontend-app
    path: ~/work/frontend-app
    role: frontend
    defaultBranch: main
    protectedBranches: [main, production]

  - name: backend-api
    path: ~/work/backend-api
    role: backend
    defaultBranch: main
    protectedBranches: [main, production]
```

### 6. Configure Providers

Use the provider best suited for each role:

```yaml
providers:
  planner:
    type: claude
    model: claude-opus-4-8
    command: claude
    auth:
      mode: subscription
      configured: true

  frontend:
    type: claude
    model: claude-sonnet-4-6
    command: claude
    dangerouslySkipPermissions: true
    auth:
      mode: subscription
      configured: true

  backend:
    type: codex
    model: gpt-5.4
    effort: medium
    command: codex
    yolo: true
    auth:
      mode: subscription
      configured: true

  scout:
    type: gemini
    model: gemini-3.5-flash
    command: gemini
    auth:
      mode: subscription
      configured: true
```

Unsafe switches:

- `dangerouslySkipPermissions: true` adds Claude `--dangerously-skip-permissions`
- `yolo: true` adds Codex `--yolo`

Use these only in trusted local/VM worktrees.

### 7. Configure Roles

Roles decide which tmux sessions start and what each agent is responsible for.

```yaml
roles:
  - name: cto
    title: Technical lead and architecture reviewer
    provider: planner
    repositories: [frontend-app, backend-api]
    responsibilities:
      - Convert issues into acceptance criteria and implementation plans.
      - Review architecture, risk, rollback, and backward compatibility.

  - name: fe1
    title: Frontend engineer
    provider: frontend
    repositories: [frontend-app]
    responsibilities:
      - Implement responsive UI changes.
      - Run browser smoke tests and capture screenshots.

  - name: be1
    title: Backend engineer
    provider: backend
    repositories: [backend-api]
    responsibilities:
      - Implement APIs, migrations, and tests.
      - Avoid destructive database operations.

  - name: qa1
    title: QA and release reviewer
    provider: backend
    repositories: [frontend-app, backend-api]
    responsibilities:
      - Verify acceptance criteria.
      - Produce final merge readiness notes.
```

### 8. Validate Config

```bash
loop validate
```

Fix any config errors before starting sessions.

### 9. Start in Safe Mode First

Safe mode creates tmux sessions and prompt files, but does not launch provider CLIs.

```bash
loop start --run issue-123
tmux ls
```

Open one session:

```bash
tmux attach -t loop-demo-product-issue-123-cto
```

### 10. Launch Real Agents

After safe mode looks right, launch configured provider commands:

```bash
loop start --run issue-123 --execute
```

Start only specific roles:

```bash
loop start --run issue-123 --role fe1 qa1 --execute
```

### 11. Use the Dashboard

```bash
loop dashboard
```

Open:

```text
http://localhost:4318
```

The dashboard shows active sessions and lets you inspect recent tmux output.

### 12. Check Logs and Stop Runs

```bash
loop status
loop logs loop-demo-product-issue-123-fe1
loop stop issue-123
```

## Core Commands

```bash
loop init                 # create loop.config.yaml and brief.md
loop auth status          # inspect local provider CLI/API-key readiness
loop auth configure --write # write detected local auth mode into config
loop validate             # validate config
loop start --run bug-42   # start role sessions in tmux
loop status               # list loop sessions
loop logs <session>       # capture recent tmux pane output
loop stop bug-42          # kill sessions for a run
loop dashboard            # open local web dashboard
```

## Common Workflows

### One Repo

```bash
cd ~/work/backend-api
loop init
loop auth configure --write
loop validate
loop start --run fix-login-bug --execute
```

### Frontend + Backend

```bash
mkdir ~/work/product-team
cd ~/work/product-team
loop init
```

Then edit `loop.config.yaml`:

```yaml
repositories:
  - name: frontend-app
    path: ~/work/frontend-app
    role: frontend
  - name: backend-api
    path: ~/work/backend-api
    role: backend
```

Run:

```bash
loop auth configure --write
loop validate
loop start --run issue-456 --execute
```

### VM Setup

Install once on the VM user that will run the agents:

```bash
npm install -g loop-orchestrator
claude
codex
gemini
```

Then:

```bash
cd ~/work/product-team
loop init
loop auth configure --write
loop start --run overnight-batch --execute
```

Because sessions run in tmux, they keep running if your laptop disconnects.

### Update Package

```bash
npm install -g loop-orchestrator@latest
loop --version
```

## Example Roles

Provider flags can be configured without raw argument strings:

```yaml
providers:
  frontend:
    type: claude
    model: claude-sonnet-4-6
    auth:
      mode: subscription
      configured: true
    dangerouslySkipPermissions: true
  backend:
    type: codex
    model: gpt-5.4
    effort: medium
    auth:
      mode: subscription
      configured: true
    yolo: true
```

## Local Auth Setup

Loop Orchestrator can inspect your machine and write provider auth hints into config:

```bash
loop auth status
loop auth configure --write
```

It detects:

- Claude CLI from `claude`, or API env vars `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`
- Codex CLI from `codex`, or API env var `OPENAI_API_KEY`
- Gemini CLI from `gemini` or `agy`, or env vars `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_CLOUD_PROJECT`

The command stores only metadata such as auth mode, command name, and env var name. It does not write secret values into `loop.config.yaml`.

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

## Troubleshooting

### `No loop.config.yaml found`

Run:

```bash
loop init
loop auth status
```

### `tmux: command not found`

Install tmux:

```bash
brew install tmux
```

On Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y tmux
```

### Provider Not Detected

Install and log in to the provider CLI, then rerun:

```bash
loop auth status
loop auth configure --write
```

### Start Fresh for a Run

```bash
loop stop issue-123
loop start --run issue-123 --execute
```

### Inspect Generated Prompts

Prompts are written under:

```text
.loop/runs/<run-id>/prompts/
```

## License

MIT
