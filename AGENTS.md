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
2. Each agent uses its own `agent/<role>/<task>` branch or isolated worktree. Do not let agents edit the same branch concurrently.
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
