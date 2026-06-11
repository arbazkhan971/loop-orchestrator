# Safety

Loop Orchestrator should be treated as an automation launcher, not a permission boundary.

## Recommended Guardrails

- Start in prompt-only mode first.
- Treat `dangerouslySkipPermissions: true` and `yolo: true` as full-trust execution modes.
- Use dedicated worktrees for each issue.
- Keep production branches protected.
- Require PR review for database migrations, auth, billing, and security changes.
- Use read-only or staging databases during end-to-end testing.
- Avoid secrets in `loop.config.yaml`; prefer environment variables.
- Add destructive-operation warnings in every role prompt.

## Database Safety

For local and staging testing:

- Use disposable seed data.
- Block writes to production databases from local environments.
- Prefer feature-specific test accounts.
- Require explicit human approval for migrations and backfills.

## Public Repo Hygiene

Do not commit:

- Private repository names
- Customer names
- Access tokens
- Internal URLs
- Real production credentials
