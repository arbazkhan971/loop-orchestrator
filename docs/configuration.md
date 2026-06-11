# Configuration

`loop.config.yaml` is the control plane for your team.

## Providers

```yaml
providers:
  frontend:
    type: claude
    model: claude-sonnet-4-6
    auth:
      mode: subscription
      configured: true
    dangerouslySkipPermissions: true
    args: []
    promptMode: interactive
  backend:
    type: codex
    model: gpt-5.4
    effort: medium
    auth:
      mode: subscription
      configured: true
    yolo: true
    args: []
```

Auth modes:

- `auto`: let `loop auth configure --write` detect local setup.
- `subscription`: use locally authenticated CLI state, such as prior OAuth/login.
- `api-key`: use the named env var for API billing.
- `env`: user still needs to install/login/set an env var.

Local setup:

```bash
loop auth status
loop auth configure --write
```

Secret values are never stored. Only the env var name is written.

Unsafe execution switches:

- `dangerouslySkipPermissions: true` adds `--dangerously-skip-permissions` for Claude providers.
- `yolo: true` adds `--yolo` for Codex providers.
- Raw `args` still work and are not duplicated when the typed switch is also enabled.

Prompt modes:

- `interactive`: start the agent and show the prompt file path.
- `stdin`: pipe the generated prompt into the command.
- `argument`: pass a short instruction pointing to the prompt file.

## Repositories

```yaml
repositories:
  - name: frontend-app
    path: ~/work/frontend-app
    role: frontend
    defaultBranch: main
    protectedBranches: [main, production]
```

## Roles

Roles define what each session should do.

```yaml
roles:
  - name: fe1
    title: Frontend engineer
    provider: frontend
    repositories: [frontend-app]
    responsibilities:
      - Implement accessible responsive UI changes.
      - Run browser smoke tests and capture screenshots.
```
