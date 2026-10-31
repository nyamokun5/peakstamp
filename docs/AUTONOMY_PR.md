Production manual drafts previously remained unsent after completed registration, and the independent UI could not pass its roster evidence check because Worker snapshots and Frontend normalization omitted the required provenance.

Persist the reviewed submission before sending, reconcile only unchanged submitted manual drafts after official goal/score readback, preserve later edits/additions and never resend after unknown ACK. Carry explicit official roster provenance from the authenticated snapshot producer to the Frontend; missing/stale evidence stays rejected. Preserve production auth, current-target checks and TEST storage isolation. Manual knockout remains refused before send.

This PR also contains the Coordinator-led five-role configuration and GitHub handoff protocol from the prior iteration. Existing scripts/auth remain preserved.

Validation: PeakStamp 581 tests passed, 0 failed/skipped; browser matrix 21/21, including actual HTML completion/late draft/reload; changed syntax/diff checks. Paired Worker suite 82 passed, dry-run successful. Independent release review: development GO, production NO-GO. No merge, deploy or real upstream writes. See docs/AGENT_HANDOFF.md for exact reviewed commit pair and remaining work.
