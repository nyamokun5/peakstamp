# PeakStamp TEST website (Cloudflare Pages)

**STAGING branch only. Do not alter GitHub Pages `main` or the production Worker.**

The TEST website is a separate Cloudflare Pages project, deploying only the `staging` branch from `nyamokun5/peakstamp`. This site contains the complete browser-based PeakStamp editor and a TEST-only SS review. The build strips out the production SS gateway, production UI adapter and production-only write modules. All TEST SS writes still go through the existing authenticated STAGING Worker.

## One-time Cloudflare Pages project setup (requires account owner)

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git, repository `nyamokun5/peakstamp`.
2. Choose a dedicated project name, suggested **`peakstamp-ss-stage-nyamokun5`** (only if available). Use its assigned `https://<project>.pages.dev` origin to configure the STAGING Worker CORS. Do not use the production hostname or GitHub Pages origin for this project.
3. Set **Production branch = `staging`**, Framework preset = None, Root directory = `/`.
4. Build command: `node --test tests/*.test.mjs && node scripts/build-staging-site.mjs`
5. Build output directory: `dist`.
6. Allow automatic Pages deployments from `staging`. Confirm the Pages URL loads the TEST banner and has no production SS selection.

## STAGING Worker allow-origin

The Worker currently allows CORS from `https://nyamokun5.github.io` only. To use the separate Pages origin, add its **exact** `https://<project>.pages.dev` origin to the STAGING-only Worker allowlist. Keep the legacy GitHub Pages origin for the existing TEST workflow. Do not add wildcards or edit the production Worker.

## Safety checklist

- Browser's TEST review offers only `staging`, disables environment selection and excludes the production API URL. The production-only JavaScript adapter is not included in the deployment.
- STAGING Worker has fixed TEST upstream tenant, `SS_ENVIRONMENT=staging`, `SS_WRITE_MODE=test-only`, and its own Durable Objects and secrets.
- All test writes require explicit UI action and valid STAGING auth.
- GitHub pull requests targeting `staging` pass the full unit/browser suites. The Pages build repeats the unit suite before publication.
- GitHub Pages `main` remains unchanged. The production Worker `shoot-sunday-sync` and its secrets must never be modified.
- Video project data is browser-origin scoped: moving from GitHub Pages to `pages.dev` does not transfer localStorage data automatically. Start video analysis on the TEST site when testing.
- Gemini analysis calls the separate `peakstamp-gemini-api.vercel.app` service; confirm its cross-origin policy works from the new Pages origin before relying on it.

## Scope

This setup creates an isolated frontend. It does **not** yet implement variable match counts or prove end-to-end video analysis from the new origin. Those require subsequent implementation and tests before production promotion.
