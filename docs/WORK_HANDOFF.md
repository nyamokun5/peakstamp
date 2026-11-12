# PeakStamp × Shoot Sunday — analysis name integration

Updated: 2026-11-12 (Asia/Singapore). Implementation on feat/analysis-ss-names-20261112; CI pending, not yet deployed to staging.

## Scope / safeguards
STAGING ONLY. No main, production Worker, production SS, or non-TEST event writes.
No live goal/result/alias writes have been made. Keep existing Worker secrets,
variables and Durable Objects. Use existing Git-to-Cloudflare builds.

## Baseline
PeakStamp staging: 32d9f176d6ff3c8f676d9bfeacd591f629847e93.
Cloudflare Pages TEST deployment bf0d9212 confirmed successful at that commit.
TEST: https://peakstamp-ss-stage-nyamokun5.pages.dev/
Worker configuration read through GitHub: existing staging config stays unchanged.
No Worker implementation change required: use GET /events, /snapshot and /staging/alias/list.

## Implementation being validated
- TEST-build-only connection/event selection in analysis panel; existing opt-in tab token reuse.
- Resolve scorer/assist against current official roster and aliases; retain raw observations.
- Store event, fixture, member, player and team identity; revalidate on SS handoff.
- Restrict selectors to official numbered fixture; same-team assist, no self-assist.
- Video Keep with complete identities confirms local goal without a second name confirmation.
- Learning still runs only after verified goal registration; consumes preserved raw name.
- Ambiguous alias mapping is rejected even if only one candidate plays this fixture.

## Files
sposched-analysis-identity.mjs, sposched-analysis-names.mjs, goal-stats.mjs,
goal-stats-ui.mjs, app.mjs, index.html, scripts/build-staging-site.mjs,
sposched-review-core.mjs, sposched-review.html, sposched-alias-auto-match.mjs,
sposched-goal-commit-alias.mjs, sposched-quick-review.mjs.

## Validation / remaining work
Local unit/regression run: 701/701 passed, including nine supplied name observations
in a synthetic official roster (not live November 8 verification). Original UI labels preserved.
Browser integration test added. Local Chromium cannot start: OS denies socket creation;
escalation disabled by execution policy. Run browser test in GitHub Actions before merging.
Not yet proven against live November 8 roster, real Gemini media or iPhone.
Do not claim the historical 9/9 result has been reproduced live.
Next: add identity, API failure/race, transfer, learning and browser tests; review bugs;
run full suite; commit to staging; verify Git-connected TEST deployment and live build SHA.

## iPhone acceptance (after TEST deployment)
Open TEST URL in Safari, choose video, expand SS names, use existing SS bridge password,
optionally remember this tab, select November 8 TEST event. Run Gemini normally.
Verify official scorer/assist names, correct only unresolved names, Keep video,
then proceed to SS review. Verify no name re-selection, correct event/fixture,
raw name retained, export/replay still work. No live score writes during automated QA.
