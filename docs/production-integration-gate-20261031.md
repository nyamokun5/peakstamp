# Production integration release gate — 2026-10-31

STATUS: BLOCKED pending production-safe integration.

STAGING verified by user: https://peakstamp-ss-stage-nyamokun5.pages.dev/sposched-review?v=reset-mobile-175

Do not bulk-merge staging into main. The staging Pages build deliberately strips production gateway and adapter; the production GitHub Pages application requires those modules.

## Acceptance criteria
- Preserve all user-verified staging UI changes, manual goals, retired-match history, match recreation, and 2/3/4 match layouts.
- Preserve production login, token handling, production API adapter, and official target event enforcement.
- Test 2/3/4 matches with distinct scores/scorers/assists, match finish, replay, duplicate protection, and network failure.
- Check mobile rendering and navigation, cache-busting, origin-scoped browser storage, no staging-only secrets or URLs.
- Run unit, browser, and deployment smoke tests; validate exact production artifacts and rollback.
- Never infer success from a staging-only pass or a Vercel status alone.

This release branch begins at production main; no deployment is triggered by this checklist.

## Deployment status audit (2026-10-31)
- Release commit `eaabdd407393585991a118e24bbbf48a92768d59`: GitHub Actions `test` and `finish-browser` succeeded.
- **Cloudflare Pages check failed** on the same commit for project `peakstamp-ss-stage-nyamokun5`. This is a deployment/build blocker until its Cloudflare logs are inspected and the root cause is resolved or explicitly established as a staging-only configuration issue.
- Cloudflare build log: https://dash.cloudflare.com/?to=/70769b8df27930cdb6ab2242c0316af0/pages/view/peakstamp-ss-stage-nyamokun5/84c92844-a48c-4be7-a9db-2a7a76309508
- Do not mark this PR fully green, deploy production, or assume GitHub Pages output has been verified from a green Node test alone.
