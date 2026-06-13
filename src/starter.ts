export function starterConfig(): string {
  return `version: 1
defaults:
  namespace: loop
  dashboardPort: 4318
  promptDir: .loop/prompts
  runDir: .loop/runs

projects:
  - name: demo-product
    brief: brief.md
    workingDir: .
    safetyMode: workspace-write
    providers:
      planner:
        type: claude
        model: claude-opus-4-8
        auth:
          mode: auto
        dangerouslySkipPermissions: true
        args: []
        promptMode: interactive
      frontend:
        type: claude
        model: claude-sonnet-4-6
        auth:
          mode: auto
        dangerouslySkipPermissions: true
        args: []
        promptMode: interactive
      backend:
        type: codex
        model: gpt-5.4
        effort: medium
        auth:
          mode: auto
        yolo: true
        args: []
        promptMode: interactive
      scout:
        type: gemini
        model: gemini-3.5-flash
        auth:
          mode: auto
        args: []
        promptMode: interactive
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
    roles:
      - name: cto
        title: Technical lead and architecture reviewer
        provider: planner
        repositories: [frontend-app, backend-api]
        responsibilities:
          - Convert incoming issues into implementation plans and acceptance criteria.
          - Review architecture, risk, rollout, and backward compatibility.
        guardrails:
          - Prefer small PRs with clear test evidence.
      - name: fe1
        title: Frontend engineer
        provider: frontend
        repositories: [frontend-app]
        responsibilities:
          - Implement accessible responsive UI changes.
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
    loops:
      - name: delivery-loop
        cadenceMinutes: 30
        maxIterations: 8
        stopWhen:
          - tests pass
          - pull request opened
          - release reviewer approves
`;
}

export function starterBrief(): string {
  return `# Demo Product Brief

Build and maintain a full-stack web product using small, reviewable pull requests.

## Operating principles

- Keep every task scoped to the requested issue.
- Do not mention private customer or repository names in public artifacts.
- Prefer backward-compatible API and UI changes.
- Run tests and include evidence before asking for review.
`;
}
