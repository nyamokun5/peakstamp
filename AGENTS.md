# Multi-agent development protocol (2026-10-31)

This repository is one half of the PeakStamp ↔ Shoot Sunday (SpoSched) integration.
Read `docs/AGENT_HANDOFF.md` before any changes. Pair repository: nyamokun5/shoot-sunday-sync.

## Roles and coordination
- **Coordinator**: inspect both repositories, record exact PR heads, decompose work into independently testable tasks, and update the shared handoff.
- **Frontend agent**: owns PeakStamp review UI, fixture classification, manual goals and browser regressions. Never change Worker APIs without a reviewed contract.
- **Worker agent**: owns SpoSched gateway, event/match validation, idempotency, ACK and recovery rules. Never weaken production read/write barriers.
- **QA agent**: owns adversarial/unit/browser tests, verifies exact candidate commits and documents failures; no deployed writes.
- **Release reviewer**: compares both exact SHAs, evaluates auth/tenant isolation, checks CI and provides explicit go/no-go. Not authorized to deploy independently.

## Work isolation
1. Work from the relevant current candidate branch/PR, NOT an assumed identical `main` or `staging`. Verify HEAD, base and changed files first.
2. Independent coding sessions use separate `agent/<role>/<task>` branches. Subagents sharing the Coordinator checkout use exclusive file leases under the autonomous protocol below; they never perform Git mutations or edit the same file concurrently.
3. Open small PRs; coordinator integrates after tests and cross-repo API review. Never force-push another agent's branch.
4. Before handing off: report repo, base/head SHA, changed paths, tests executed/results, safety constraints, open questions and next action. Update handoff.
5. Treat synthetic, local, staging, and production tests as distinct. Never describe local simulations as successful live writes.
6. Do not print or commit API keys, bridge tokens, Cloudflare secrets or personally identifiable player data.

## Safety stop rules
- No automatic merge of existing release/migration draft PRs.
- No production SpoSched writes, Cloudflare secret/binding changes, production deploys or permission unlocks as part of agent setup.
- Any real write requires target event/tenant/credentials independently verified, scoped operator authorization and a separate release gate. A general wish to automate development is NOT authorization to mutate production.
- An ambiguous ACK, changed match ID, retired/recreated match or mismatched event/fixture must fail closed: do not blindly retry.
- Keep production and TEST credential, origin, namespace, and storage separation intact.
- If blocked, preserve work on a branch and document the precise blocker instead of switching environments.

## Operating loop
Inspect → select one task → create isolated branch → implement → test → independent review → update handoff → integrate via explicit PR. Parallelize independent UI/tests/docs, not conflicting shared API changes.


## Autonomous Coordinator protocol
A user request such as "開発を続けて" authorizes implementation, relevant tests, review, fixes, commits, pushes to new agent branches and PR creation within this project. It never authorizes PR merging, production deployment, production SpoSched writes, credential changes or permission unlocks.

The primary session is Coordinator. Use the runtime's available subagent tools to delegate independent work proactively; ask the user only for a missing requirement, credential or access that actually blocks useful work. Do not ask the user to launch agents that this runtime can launch. The project-local .codex/config.toml registers five CLI roles; managed Cloud tools may use task names instead, so include the role instructions in each spawn message. Role files do not install a daemon, guarantee Cloud feature activation, or keep an ended session running.

Before work: read both handoffs, git status and exact PR refs. Preserve user changes. Use existing isolated checkouts; no worktree is required. Never reuse main as a substitute for a candidate SHA. Coordinator owns branch/commit/push/PR operations. Shared-checkout subagents MUST NOT switch branches, reset, commit or push. Independent Cloud sessions use separate agent/<role>/<task> branches and never share one writable checkout.

Coordinator records exclusive file ownership leases in docs/AGENT_HANDOFF.md before assigning edits. A lease lists role, task, paths and acceptance checks. Never assign the same file to simultaneous writers; serialize changes to shared HTML, API contract, CI and handoff. Reassignment requires the prior agent to finish or stop and acknowledge release. Read-only review can overlap; its evidence must identify the diff or SHA reviewed. Subagents report touched paths, tests, failures, safety status and next action. Only Coordinator updates the handoff.

Operating loop: select an unblocked bounded task -> record leases -> spawn independent agents -> wait for results -> inspect all changes -> run appropriate tests -> diagnose and fix failures -> independent Release Reviewer -> integrate into a new agent branch -> create a small PR targeting the existing candidate release branch -> checkpoint. Do not stop at advice when implementation is authorized. Return to review after material fixes. Do not claim all backlog items complete when a bounded iteration is done.

On interruption/end: docs/AGENT_HANDOFF.md must name both candidate refs/SHAs, own branch/commit, remote PRs, completed work, exact tests/results, unresolved blockers and the next bounded task. Commit and push checkpoint documentation to the agent branch when Git access permits; keep secrets/PII out. If PR API or push is blocked, record the exact blocker and local recoverable commit and finish independent work. GitHub checkpoints survive sessions; local subagents and processes do not. On resume, fetch the checkpoint branch, compare refs and tests, recreate agents and leases; do not assume prior agent processes exist. Read-only status is not authorization to retry an uncertain production write.
