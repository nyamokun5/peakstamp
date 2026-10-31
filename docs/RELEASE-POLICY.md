# PeakStamp × Shoot Sunday release policy

## Default: test without deployment

- Development commits and pull requests run GitHub Actions syntax, unit, and browser tests.
- Do not use production or staging deployments to test individual source changes.
- Batch related changes and run a single integration test before a staging preview.
- A successful test run does not authorize a production write.

## Staging

- Use isolated staging data, tokens, and endpoints.
- Deploy staging only for an integration checkpoint or a user-requested device test.
- Do not use the production SpoSched event as test data.

## Production

- Keep release PRs in draft until both PeakStamp and Worker are validated.
- Deploy the Worker before exposing PeakStamp's new production UI.
- Require official, authenticated, read-only target-event and fixture verification before any write.
- Production writes are restricted to the currently verified target event.
- Never automatically replay an uncertain production mutation. Preserve request IDs and inspect authoritative status.
- A recreated fixture generation requires explicit human consent and official retirement checks.
- Keep deployment and actual SpoSched writes as separate actions.

## Provider integrations

- Vercel's build-rate-limit status is not a code test result. It must not be represented as a passing check.
- Review Vercel Git integration and GitHub branch protection before disabling or removing Vercel statuses.
- Prefer one preview hosting provider; Cloudflare staging is the intended preview target.
- Do not change production deployment triggers or merge a release PR without validating the relevant GitHub permissions and deployment controls.

## Current release candidates (2026-10-31)

- PeakStamp PR #177, Worker PR #71; both draft.
- PeakStamp unit/browser/Cloudflare checks passed at 7b92784; Vercel status is rate-limited.
- Worker tests and build checks passed at 1c94cd5.
- Production deployment and writes remain outstanding.
