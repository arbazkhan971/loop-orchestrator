# Publishing

Loop Orchestrator is a pure npm package. It does not need a native binary shim.

## One-time setup

Add an npm automation token as a GitHub repository secret:

```bash
gh secret set NPM_TOKEN --repo <owner>/loop-orchestrator
```

The token needs publish access for the `loop-orchestrator` package.

## Release

1. Bump `package.json` version.
2. Commit the change.
3. Create and push a matching tag:

```bash
git tag v0.1.0
git push origin main v0.1.0
```

The release workflow runs:

- `npm ci`
- `npm run validate`
- `npm pack --dry-run`
- version/tag match check
- `npm publish --access public`

## Local dry run

```bash
npm run validate
npm pack --dry-run
```
