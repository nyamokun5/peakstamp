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
Worker npm test includes test/production-browser-harness.test.js. PeakStamp node --test tests/*.test.mjs includes production-storage-races.test.mjs. Existing single-checkout browser CI still runs its 21 scenarios. The new paired runner requires TWO checkouts and is not automatically registered in those single-repository jobs; no CI success or cross-repository credential access is inferred from local execution. A future paired CI job must explicitly select/record both refs and supply both checkouts without adding credentials to code.

## Safety and remaining limits
All player/team/credential values in the harness are synthetic. No Cloudflare deployment, real SpoSched mutation, permission change or PR merge occurs. Memory storage/core execution is not workerd or Cloudflare Durable Object storage proof.

The application now preserves marker/receipt records changed while final official inspection awaited. localStorage read/write is not an atomic cross-tab lock: fully simultaneous claims still depend on the existing event-scoped Worker journal to prevent repeated writes. Do not remove the server gate or describe the local guard as a browser mutex.
