# Paired production browser regression

This is a local synthetic integration check, not a deployed write test. It runs actual PeakStamp HTML against the paired Worker public router, Durable Job Core, executor, signed per-match gate and official readback adapter. Only the upstream SpoSched HTTP responses and persistent storage implementation are synthetic. Worker status/body/CORS are passed through without invented success responses. Unexpected HTTP is refused; no native-network fallback exists.

## Required checkouts and tools
Use the reviewed pair recorded in docs/AGENT_HANDOFF.md, with both repositories present. Node 22, Playwright and Chromium must be available. The managed environment already provides them. Keep the existing proxy/auth settings; this test does not use injected real API credentials.

From /workspace/peakstamp:

```sh
WORKER_CHECKOUT_PATH=/workspace/shoot-sunday-sync \
PLAYWRIGHT_MODULE=/workspace/.setup/node_modules/playwright/index.mjs \
CHROMIUM_PATH=/usr/bin/chromium \
/workspace/.setup/node_modules/node/bin/node scripts/test-paired-production-browser.mjs
```

WORKER_CHECKOUT_PATH must be an absolute path containing test-support/production-browser-harness.mjs. Missing paths fail rather than skipping or using canned responses. The Worker test harness installs one strict global fetch interception for its lifetime; never run two harnesses concurrently in the same Node process. close() drains waitUntil work before restoring fetch.

The default matrix executes six successful fixture counts (1, 2, 3, 4, 8, 24) plus four failure scenarios: lost start response after Worker acceptance, lost goal response after synthetic upstream commit, submission-storage failure and changed cross-tab request marker during completion. Each scenario isolates browser storage, preserves real production CORS behavior, and checks page/route errors. Success scenarios use real decision UI for scoreless draws and preserve a late draft through completion/reload.

For focused diagnosis only, PAIRED_FIXTURE_COUNTS=1,2 selects counts and PAIRED_SUCCESS_ONLY=1 omits failure scenarios. Report those cases as omitted, never as a full-matrix pass. Synchronization awaits have deadlines and diagnostics rather than waiting forever.

## Repository CI coverage
Worker .github/workflows/paired-browser.yml now defines the paired job on relevant pull requests, main pushes and workflow_dispatch. It checks out the exact Worker PR head (or selected event commit) and public PeakStamp at reviewed immutable SHA 0fa09b4bc9f1c9c37e6e719cb0eb4980a5ccb20a. No extra read token is required: the private Worker is the workflow's own repository; its public counterpart needs no private-repository access.

The job uses contents:read only, persist-credentials:false, Node22 and an isolated Playwright1.51.1 prefix outside both checkouts. It installs Chromium, verifies exact clean source roots before and after the full ten-scenario matrix, preserves pipeline exit status, and uploads safe before/after manifests plus the synthetic browser log even on failures when available. No pull_request_target, production environment, deploy command or SpoSched credential binding is used.

scripts/verify-paired-checkouts.mjs requires full40hex SHAs, exact real Git roots, correct sanitized origins, clean tracked/untracked state and tracked in-root harness/runner files. Mismatch fails before testing. Its PAIRED_MANIFEST_PATH must be a new absolute file outside both checkouts; before/after use distinct files to preserve original evidence. Existing single-repo CI also runs the verifier's unit tests. Advance the counterpart pin only through reviewed changes after Frontend source changes; a later docs-only Frontend commit does not change the tested application tree.

Local clean-clone replay passed ten scenarios with identical before/after pair manifests. See Worker docs/paired-ci-local-replay-20261031.json. Local replay uses preinstalled system Chromium; the hosted install --with-deps Chromium step and GitHub-hosted outcome remain UNVERIFIED until an actual Actions result is observed. Static actionlint and local execution are not a substitute for that outcome. Worker npm test includes the synthetic harness and checkout-verifier tests; PeakStamp unit CI includes storage-race tests.

## Safety and remaining limits
All player/team/credential values in the harness are synthetic. No Cloudflare deployment, real SpoSched mutation, permission change or PR merge occurs. Memory storage/core execution is not workerd or Cloudflare Durable Object storage proof.

The application now preserves marker/receipt records changed while final official inspection awaited. localStorage read/write is not an atomic cross-tab lock: fully simultaneous claims still depend on the existing event-scoped Worker journal to prevent repeated writes. Do not remove the server gate or describe the local guard as a browser mutex.
