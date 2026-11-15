# PeakStamp full production integration — 2026-11-15

## Verified input and integration method

Production `bacda0b5bebd7e3a1b5579fb8ea9586912f61a72`, TEST `a2911bdac7cd8f9da866bde8e10d4488f7036322`.
GitHub PR #203 head `2be8190f2ee418ec8a71d8e809e1cf9fc66810dc` was open/unmerged at the start.
`git rev-list --left-right --count main...staging`: 117 production-only, 391 TEST-only commits.
Direct main/staging comparison: 202 files, 10,452 additions and 2,862 deletions.

This branch performs a real three-way merge, preserving both histories rather than replacing production with a TEST tree. Fourteen conflicting files were resolved individually. Files added only on main (guide/assets, match review, independent production adapters and regression tests) stay present. PR #203's production continuation helper/UI and both regression suites are reused on top of the full feature integration. Existing main URL remains `https://nyamokun5.github.io/peakstamp/`.

## Feature inventory and decision

“Present” refers to code, not a claim of successful live-device acceptance.

| Feature | TEST implementation | Production before merge | Migrate | Risk and resolution / code evidence |
|---|---|---|---|---|
| Local iPhone video/import ordering | app.mjs source board, matchup fields, multipart sources | Import + multipart and decoder recovery | Yes | Three-way merge retains multipart source numbering and main recovery; `tests/manual-multipart-update.test.mjs`, `scripts/test-minimal-ui-browser.mjs` |
| Large/long audio batches | gemini-primary.mjs diagnostics, empty response handling; gemini-wav-chunks.mjs | Streaming chunks and per-file retry already present | Yes | Keep streaming; no extra media upload paths; `tests/gemini-wav-stream.test.mjs`, extended-duration and diagnostics tests |
| Latest Gemini phonetic prompt | api/gemini-audio.js revision `phonetic-hiragana-20261112-v1` | Older prompt without phonetic guarantees | Yes | Preserve model `gemini-3.8-flash`; add public GET version to verify deployed code without calling Google or exposing keys; `tests/gemini-public-version.test.mjs` |
| Official roster name resolution at analysis | sposched-analysis-names.mjs and analysis-identity | Absent | Yes | Environment-aware GET transport, production/staging credential + event key separation, current official assignment and UUID revalidation; new cross-environment identity rejection test |
| Alias/nickname resolution | alias-auto-match, alias-admin, name-resolution | Fuzzy names only | Yes | Ambiguous aliases remain unresolved even across teams; official raw speech retained; tests/ss-name-two-stage and analysis-names |
| Manual corrections / alias learning | goal-stats-ui manual selectors; alias-confirm; verified batch learning | No shared alias UI | Yes | Production explicit alias confirmation uses /production/alias/confirm and correct tenant; no automatic retry; TEST inline mutation methods reject production mode |
| Video Keep/Reject and goal review | Sequential next selection, excluded toggle, duplicate goal detection | Main decoder recovery + minimal controls | Yes | Keep main playback controller/native fallback and minimal CSS; use stage queue and identity checks; main mobile playback/export browser test retained |
| Matchup recognition / edit preservation | video-matchup, opening audio speech propagation | Confirmed multipart match dialog and persistent card | Yes | Keep confirmed main dialog/card and manual field precedence, combine staging source-level recognition; recovery-matchup and goal-matchup-confirmed regressions |
| Independent 1–3 matches | worker-independent, fixture-layout, generic fixture cases | Production-specific independent preflight/completion already present | Yes | Retain production official-format and target gate; stage richer generic TEST UI stays TEST-only; no weakened production format policy |
| Staged knockout registration | Inline stage semifinal/placement flow | PR #203 pending | Yes | Adopt PR #203 production continuation, same persisted request and fresh fixture IDs, append marker written before I/O; no blind retry |
| Finish, helpers, duplicate detection | New roster selectors and variable fixture finish policies | Production batch and protected TEST direct manual entry | Yes | Keep main manual registration and bounded journal, stage fixture player filtering; execute only explicit user action and official IDs |
| Unknown response / stop / resume / retired jobs | Worker completion proof and retired-generation checks | Main fail-closed stale-job and final snapshot error handling | Yes | Preserve both: old generation never displayed as current success, latest official readback required, ambiguity retains request markers and forbids replay |
| Simple SS results UI | simple-results/simple-goal-fix, per-match score plan | Detailed production UI | Yes | Production official four-knockout fixtures use the same per-match score/name/assist/exclusion/winner controls. Production submit remains on the independently verified production adapter; TEST save is hidden. Unlabelled legacy fixtures retain the compatible detailed view. Existing finished-goal mutations are not enabled without their production-specific safety contract |
| Highlight MP4 progress/save/redo | Most exporter logic shared | Main export-screen wake lock, clear status/download | Retain production improvements | export-screen.mjs, exporter.mjs and main montage integration preserved; minimal-ui browser exercises encode mock+real decoded media, progress/save/re-export/wakeLock |
| Highlight Studio JSON | Shared edit-transfer and montage export | Present | Retain | No schema replacement; YouTube original-file alignment still required before HS export |
| YouTube title/audio/video analysis | youtube-organizer/session/registration | Not present in tree | Yes | GitHub Pages cannot execute Pages Functions. Production title/share calls use production Worker /youtube endpoints; stage stays isolated Pages API |
| YouTube persistent share/playback | CF Pages HIGHLIGHTS storage and watch module | Existing static highlights preserved | Yes | New production KV supplied by Worker deployment, no stage KV reuse; shared link stays existing GitHub Pages youtube-watch.html path |
| YouTube SS video slots | TEST Worker video-slot | Not wired | Yes | Production /production/video-slot, exact environment/event/match/slot validation and explicit PRODUCTION VIDEO REGISTER; Worker handles duplicate/unknown state |
| Playback presentation / Drone exclusion | YouTube filtered sources, overlay/playlist | Existing main static highlights | Yes + retain | Existing highlights HTML not removed; YouTube excludes Drone sources, same sequential playback without transition/zoom injection |
| Guide and minimal mobile UI | Older stage source | Main guide images, minimal-ui.css, match cards, narrow playback | Retain | All main-only assets and CSS retained; no guide deletion |
| TEST video cache / experimental writers | test-video-cache, inline stage registration | Not enabled | Do not enable on production | Cache controls hidden in production. Production analysis is read-only except explicit alias action, inline TEST write helpers throw before fetch. Main SS registration link visible in production, using the simple official-knockout review with protected production submit |

## Runtime contracts and release order

1. Worker first: official `roster_source: official-current-event-teams` and roster UUIDs, `/production/alias/list` + explicit confirmation, staged batch append, independent production capabilities, production YouTube title/share/slots. Preserve team pin, current target event, persisted journal and existing Durable Object bindings.
2. Worker production `HIGHLIGHTS_PRODUCTION` must be a distinct KV namespace. No TEST storage is copied. Frontend uses production Worker for `/youtube/title` and `/youtube/share`; sharing authenticates via existing PS access code without browser server secrets.
3. Merge/deploy frontend main through existing GitHub Pages and Vercel Git integration. No URL switch is required. TEST Pages build still removes production adapter and gateway from the TEST review output; body marker chooses isolated analysis transport.
4. Read-only verification: GitHub Pages exact assets and published commit, Worker version/contracts and existing-event reads, Vercel `GET https://peakstamp-gemini-api.vercel.app/api/gemini-audio` must return model `gemini-3.8-flash`, promptRevision `phonetic-hiragana-20261112-v1`. CI alone is not proof of deployed prompt revision.
5. Do not send real goal/result writes as automated release tests. Actual iPhone media/AI output and explicit approved-event registration remain user acceptance tasks.

## Rollback

Keep production baseline SHA above as the frontend rollback point. Revert the integration merge through the existing main deployment path; do not force-reset shared main. Vercel can promote the previous deployment `dpl_wFvt5Tc4uLHFtgyX8AogZenDxpTT` if needed (coordinator verifies current deployment identities). Worker must have its previous version/deployment recorded before promotion. Code rollback does not roll back SS data, Durable Object journals or KV shares; do not delete/replay them. Reverting browser code must not erase current request IDs or turn unknown requests into fresh submissions.

## Validation evidence

- Combined `tests/*.test.mjs` and root `*.test.mjs`: 893/893 passed after PR #203, public health and production identity tests were included. Targeted production planner, completion recovery and UI safety checks also pass after the simple production UI was wired.
- Top-level alias/YouTube modules plus affected pure script tests: 136/136 passed.
- Both legacy and simple-production gate browser variants verify disabled release and available current target with zero mutation requests.
- Production analysis browser (`TEST_PRODUCTION_ANALYSIS=1`): GET-only network mocks, official selectors, Keep/raw identity export, alias outage, stale response, production SS review transfer passed.
- Main `.github/workflows/test.yml` now includes top-level `*.test.mjs`, both production and TEST analysis browsers, inline decisions, retained main mobile/manual regression checks, all existing Worker uncertainty/pause/reload variants and newer staging UI regression checks.
- Browser test fixtures that represent AI observations use `origin: audio`; main manual-origin semantics (`manual: true`) remain intact and are verified separately by direct manual tests.

Real iPhone Safari, paid Gemini media calls and real SS writes are not reproduced by mocked browser tests. Chromium on this environment cannot encode AAC with the real encoder; the browser export regression uses real video decoding and a deterministic encoding mock. No claim of live MP4 success on iPhone is made before device acceptance.

## Same-page production registration

The production goal-review action and the goal-completion dialog now both run registration in the editor. They do not open `sposched-review.html` or create a new tab. Normal registration needs one explicit click: fresh production target/tenant/fixture checks, existing-job inspection, start, progress polling, staged second-round append and official completion readback. Tied results are chosen on the same page.

`sposched-production-inline.mjs` uses the same production batch key as the previous page so an old or uncertain submission cannot become a fresh job. Start, append and decision intent markers are written before I/O. A passive inspection never appends or restarts a job; unknown responses do not retry. Input/event/member identity changes stop the active sequence. Human matchup confirmation survives the goal export so waiting third/fourth-game identities remain usable before their official match UUIDs are issued. The Worker still verifies actual fixture UUIDs before each mutation.

The TEST inline handlers stay in their TEST-only branch; production transports require production confirmation strings, matching selected event/context and production response identity. Bracket recreation remains TEST-only. Both environments reject credential-bearing redirects. The production-only coordinator is excluded from the TEST build.

Validation: 913 unit tests passed before the final transport redirect setting; the new real-DOM browser regression covers one-click start-to-append-to-completion and an uncertain append with no replay, using the real analysis transport against mocked responses. Production and TEST analysis browsers and the legacy inline decision browser also passed. CI reruns the required full suite for the release SHA. No real SS write is used as a test. Rollback is a revert to pre-change main `0ca0e7828359e58db1db389943bd12a6a1d5ab03`.

## Official event-roster guests

An official SS guest may have a valid event-scoped player_id without a registered-member user_id. Analysis previously required both IDs for every player, so a locally confirmed guest goal lost its scorer during registration preparation. Preserve the explicit roster player type and allow a guest only when the current official event roster supplies a unique player UUID and matching team. The display-name suffix does not authorize anything. Registered members retain the previous two-ID requirement and identity shape.

Guest identities remain bound to environment/event/fixture sequence, team, type and event player UUID. When later match UUIDs appear, fresh official opponents and identities must still agree. Changed/reused/missing IDs or changed type/team invalidate the identity. Official-roster guests are distinct from unregistered free-text guest entry and never become shared member aliases. The UI marks an otherwise locally confirmed goal as roster-unverified when its current identity is invalid.

Validation includes a fourth-goal guest on Team 4 through the real in-page UI/production transport with mocked HTTP, semifinal and later-round registration, no member alias writes, 920 unit tests, and the existing production analysis browser. No real SS goal/result writes are used as tests. Rollback baseline: main 091ab3ecb0907bedad4fbd08d8b0bdda7d3c2bdd.

## YouTube and local source workflow parity

The former `?youtube=1` standalone organizer now mounts URL entry into the same
three-step page. Both modes use the same access-code persistence, match-card
confirmation, goal editor and official SS identity verification, goal clip
Keep/Reject, highlight rows, journey dialogs and production inline registration.
Only the media source and YouTube picture controls use adapters. Existing
YouTube candidates and confirmed drafts migrate without overwriting shared edits;
no waveform samples are invented for URL sources.

YouTube Gemini requests go through `/api/gemini-youtube` in the existing Vercel
project with `X-PeakStamp-Access`; Google credentials and fixed prompts remain on
the server. A saved analysis is reused on reopen or normal Analyze; no automatic
paid retries occur. Duration inquiry and analysis each make at most one provider
request, with the existing 30-minute video limit. Public GET and OPTIONS can
verify deployment/CORS without paying for analysis.

MP4 uses the same montage controls/exporter, after selecting a matching local
original (duration checked). The URL alone cannot supply a browser-readable MP4;
without an original the existing YouTube share player remains available. Original
File objects are never persisted to JSON; goal identity stays keyed to the stable
YouTube source, separate from the optional export File.

Validation includes real entry-point iPhone DOM flow, cached reload without more
provider requests, shared goal replay/roster/time/trim/Keep/export identity, native
media restoration, legacy drafts and server auth/input bounds. All Google/SS
writes in tests are mocks. Rollback: revert this PR to main
`be922beb4bcf3e2cebe395908f4e883707363b2d`; previous Vercel production deployment
`dpl_J8Nz5hWbbcxb92e2qeRNAdjDLsWC`. Code rollback does not revert user data.

## Local highlights → matching YouTube share

Local montage export now offers “同じ範囲でYouTubeハイライトも作る”.
Assign a public YouTube URL to each selected original and confirm the videos have
the same content and starting point. The final `buildMultiClipPlan` supplies the
exact source-local start/end values, merged overlaps and source order; no AI or
video re-import is involved. Title overlays, picture crop and transition effects
remain MP4-only. The shared access code and existing environment-specific
YouTube share endpoint/player are reused; SS records are not changed.

A per-payload local journal is persisted before POST. Successful payloads reuse
their link. Unknown responses are inspected by GET on subsequent clicks and are
never automatically resubmitted. Range or URL changes invalidate the displayed
link. Tests cover multi-source decimal ranges, merged overlaps, duplicate clicks,
unknown response/readback and edits after publication, with all writes mocked.
Rollback is reverting this frontend change to main86f18e3; shared links already
created by users are not deleted.

### Inline mirror recovery

The local mirror now creates a self-contained `youtube-watch.html#clips=…` link
on the device. It no longer needs KV publication, an access code or a network
round trip. Existing pending publication journals remain intact and are never
resubmitted or labelled as completed by this flow. URL mappings keep their
existing storage key, so users can reuse them after updating the page.

The watch page validates version, length, clip count, video IDs, finite ranges and
text lengths before loading the standard YouTube player. Legacy `?id=…` links
still use their existing read-only endpoint. Invalid inline payloads fail closed.
The link includes the selected ranges and display labels, so share the full URL;
no access code or edit key is embedded. Large payloads are rejected locally.

Validation: 946 unit tests and mobile browser recovery through actual watch-page
initialization/replay with a mocked YouTube player; empty credentials and a
pre-existing pending journal, zero external API requests/writes. Rollback baseline
is mainc1a0d2c; preserve pending journals when reverting.

## Highlight edit history and named YouTube scenes

Ordinary highlight decisions now persist per full source-file fingerprint
(name, byte size, lastModified), independently of goal records and AI caches.
Reimport restores the saved duration, Keep/Reject, title, trim and crop immediately;
no waveform is invented and no analysis request is needed. Reanalysis matches
nearby unambiguous scenes, retains reviewed scenes missing from the new scan and
rebases temporary source IDs. Goal-owned clips and SS identity data are excluded
from this store. Changes save on actual edit/review updates, and the restored
scenes remain eligible for the existing export plan.

Mirrored YouTube ranges now include names from confirmed goals only, displayed
as `ゴール(西村)/アシスト(高崎)`. Member buttons filter the scene list and jump
to the person's first scene. Merged ranges preserve all distinct participant
names (including names containing a middle dot) in an optional validated inline
payload field. Existing seven-field links remain readable. Existing links without
names must be regenerated to include them; previously discarded, never-saved
ordinary decisions cannot be reconstructed retroactively.

Validation: 951 unit tests, real app Keep/Reject → reload/reimport browser, and
mirror → actual watch-page labels/person-filter/replay browser, all with no paid
analysis or SS/KV write requests. Rollback baseline main369813de71f9be2f6fb82b5b6b63b3690ef5e092;
leave saved history in place when reverting.
