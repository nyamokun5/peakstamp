# PeakStamp × SpoSched — multi-agent live handoff
**Checkpoint:** 2026-10-31 (GitHub metadata inspected; new agent setup branch only)
**Pair:** `nyamokun5/shoot-sunday-sync`
**State:** In-progress production-safe integration. NOT RELEASED by this setup.

## Authoritative active integration candidates
- PeakStamp: [PR #177](https://github.com/nyamokun5/peakstamp/pull/177), `release/validated-staging-integration-20261031`, observed head `365aad8bd33202b520b54e6f74a9cc4be115246f`, draft / base main.
- Worker: [PR #71](https://github.com/nyamokun5/shoot-sunday-sync/pull/71), `release/validated-staging-integration-20261031`, observed head `3b2893968bb68d7712ab49c85a1a7b1fbaaad919`, draft / base main.
- Full staging-to-production migrations are separate **draft preparation** PRs: PeakStamp #176 (`staging` → `main`) and Worker #70 (`staging` → `main`). Do not merge wholesale.
- Other open safety work includes PeakStamp #147 and Worker #53. Review for overlap before moving code.

## Proven from PR descriptions (not independently retested here)
- Active integration PRs port pure official fixture classification with tests for 2/3/4+ match formats.
- Remaining gaps explicitly identified in PRs: production UI wiring, manual goals, recreated/retired match handling, real batch executor, browser and cross-repo integration regression, deployment validation.
- Existing production READ/WRITE boundaries and adapters must be preserved. TEST/staging features and identities are not interchangeable with production.

## Priority work queue
1. Coordinator: inspect exact current heads and cross-repo contract; map what is already implemented; update this file with evidence.
2. Frontend: integrate official event fixture selection and variable number of matches into production UI without removing current auth/adapter.
3. Worker: complete production-safe batch execution for verified target event, including recreated match IDs and replay/unknown ACK protections; maintain explicit write gates.
4. Frontend: implement manual goal input in the same reviewed flow; coordinate payload schema with Worker agent.
5. QA: unit + mocked browser regression covering 2/3/4 matches, recreated/retired matches, finish state, 3rd-place match, duplicate submissions, stale snapshots, mobile layout and network failures.
6. Release reviewer: review CI exact heads, candidate environment separation, manual staging proof and gated production plan; record blockers. Do not deploy by default.

## Required agent status format
- UTC timestamp / agent / task:
- Repository + branch + base SHA + head SHA:
- Files and behavior changed:
- Tests (commands, exact pass/fail, CI links):
- Environment exercised (mock/local/TEST/production read-only):
- Remaining issues and production safety status:
- Handoff to next agent (specific file/function/PR):

## Current multi-agent setup
- This branch adds instructions/handoff only and should be reviewed as a separate documentation PR.
- Agent orchestrator/runtime is NOT installed by documentation alone: agents run via separately launched coding sessions (for example Codex/IDE or cloud coding agents) with repository access and isolated worktrees.
- Do not assume a persistent autonomous agent, background job, configured runtime, or new credentials until verified.
