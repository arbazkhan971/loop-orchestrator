# Configuration

`loop.config.yaml` is the control plane for your team.

## Providers

```yaml
providers:
  frontend:
    type: claude
    model: claude-sonnet-4-6
    args: ["--dangerously-skip-permissions"]
    promptMode: interactive
  backend:
    type: codex
    model: gpt-5.4
    effort: medium
    args: ["--yolo"]
```

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
