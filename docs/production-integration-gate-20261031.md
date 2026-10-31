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
