Production manual drafts previously remained unsent after completed registration, and the independent UI could not pass its roster evidence check because Worker snapshots and Frontend normalization omitted the required provenance.

Persist the reviewed submission before sending, reconcile only unchanged submitted manual drafts after official goal/score readback, preserve later edits/additions and never resend after unknown ACK. Carry explicit official roster provenance from the authenticated snapshot producer to the Frontend; missing/stale evidence stays rejected. Preserve production auth, current-target checks and TEST storage isolation. Manual knockout remains refused before send.

This PR also contains the Coordinator-led five-role configuration and GitHub handoff protocol from the prior iteration. Existing scripts/auth remain preserved.

Validation: PeakStamp 588 tests passed, 0 failed/skipped; browser matrix 21/21, including actual HTML completion/late draft/reload; changed syntax/diff checks. Paired Worker suite 93 passed, dry-run successful. Independent release review: development GO, production NO-GO. No merge, deploy or real upstream writes. See docs/AGENT_HANDOFF.md for exact reviewed commit pair and remaining work.


Paired-browser iteration: actual HTML now drives the actual paired public Worker/DO/executor/signature gate via strict synthetic upstream interception, with original Worker CORS/status/body. Ten scenarios cover 1/2/3/4/8/24 fixtures, unknown start/goal ACK, storage failure and changed cross-tab completion evidence. A reproduced final-inspection race is fixed: another tab's marker or receipt is preserved and no start is sent. New per-repo tests run in existing CI; the two-checkout paired runner has local evidence only until a paired CI job supplies explicit refs. See docs/PAIRED_BROWSER_TEST.md. Full local counts: PeakStamp588, Worker93, existing browser21/21. No merge/deploy/live writes.


Paired CI is now defined in Worker .github/workflows/paired-browser.yml: read-only checkouts of exact Worker candidate and reviewed public PeakStamp0fa09b4, full10 synthetic browser cases, before/after clean source verification and safe artifacts. New verifier8/8 and Worker full101 passed. Clean-clone local replay also passed all10 with identical manifests, using fresh Playwright1.51.1 and existing system Chromium. GitHub-hosted result/browser-install remains unverified; no new secrets/deploy/merge/live writes. See paired CI checkpoint and local replay evidence.
