# Architecture

Loop Orchestrator is a small Node.js CLI around four concepts:

- Config: `loop.config.yaml` defines providers, repositories, roles, and loops.
- Prompt generation: each role receives a run-specific prompt file under `.loop/runs`.
- Tmux control: sessions are named predictably as `namespace-project-run-role`.
- Dashboard: a local HTTP server reads tmux status and pane logs.

## Flow

1. `loop start` loads and validates config.
2. The selected project is resolved.
3. One prompt is generated for each enabled role.
4. A tmux session starts for each role.
5. In safe mode, the session opens a shell with the prompt path.
6. In execute mode, the configured provider command is launched.

## Provider Strategy

Providers are intentionally thin. The orchestrator does not need private SDK access. It runs terminal tools already authenticated on the machine:

- `claude`
- `codex`
- `gemini`
- any custom command

This keeps setup simple and makes the tool useful across different agent CLIs.
