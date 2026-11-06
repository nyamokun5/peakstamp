# Minimal mobile UI review — 2026-11-06

Base: `36d81095aaae7974256f6bb6114f22d4aa50ac78` (`main`).
Branch: `ui/minimal-mobile-20261106`.

## Scope and dependency review

`app.mjs` builds highlight controls and connects journey actions. Its processing
functions are untouched; changes are import cache keys, a review navigation
callback, a hint string and a disclosure around existing exact-time inputs.

`goal-stats-ui.mjs` mixes presentation with saving/confirmation callbacks. Those
callbacks retain their existing validation, mutation, persistence and clip sync.
The only behavior addition is a transient review-again cursor: begin at the first
non-excluded goal and visit remaining non-excluded goals in order. It never clears
judgments. The normal unreviewed-goal path is preserved. Tests compare saved data
and multi-clip export plans before and after repeating identical decisions.

`goal-scene-editor.mjs` keeps the same trim handles, exact-time inputs, pinch
listeners and callbacks. Exact inputs are folded; duplicate time labels and the
Safari native-player button are hidden. The native handler remains available in
code. There is one visible playback-time readout by default.

`first-run-guide.mjs` and `journey-coach.mjs` control help/dialog presentation only.
No automatic first-use tutorial. Goal completion offers review again, highlights,
and the existing registration page in a separate tab. This link performs no write.
`minimal-ui.css` is an isolated presentation layer; it does not hide error regions.
Existing disclosure controls retain keyboard-operable precise editing inputs.

The detector, audio/Gemini pipeline, match recognition, goal data, clip/zoom math,
playback engine, MP4 exporter, persistence/recovery and every `sposched-*` module
and registration HTML have zero diff from base. No Worker repository was changed.

## Validation

- Before changes: 632/632 Node tests pass, no skip or failure.
- After changes: 634/634 Node tests pass, no skip or failure.
- 10 initial mismatches were assertions requiring the old automatic guide or
  long/duplicated labels. Updated only these presentation expectations. Cache-key
  assertions also follow the new UI module version. Processing assertions remain.
- Existing mocked browser suite: 21/21 before and 21/21 after, including manual
  registration, four-fixture batch, finish, pause/resume, lost replies, recreation,
  stale/pending recovery, event races and production gates. All external HTTP is
  intercepted; no real SpoSched requests or writes.
- Added mobile browser regression using a generated local MP4: 375x667, 390x700,
  430x740. Goal control height: 577/585/608 px. Highlight card height:
  570/578/601 px. No horizontal overflow. Playback, exact trim input, goal
  confirmation, keep, completion actions and unchanged data on review restart pass.
- Japanese-font screenshots inspected at 375 px. Syntax and whitespace checks pass.
- Browser environment: Chromium 138 via local Playwright. This is not iOS Safari.

## Release status

Not deployed or merged. Real iPhone playback/pinch/MP4 export and an independent
human check of first-use clarity remain outstanding. Mocked and unit verification
cannot establish those real-device outcomes. Do not call the full acceptance
criteria complete until they are checked. No production SpoSched write test.
