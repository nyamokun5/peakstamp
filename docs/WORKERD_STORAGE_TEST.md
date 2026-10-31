# Local workerd Durable Object persistence regression

This explicit post-install command runs the unchanged production entrypoint and its real Durable Object classes in local workerd/Miniflare. Outbound official API traffic is exclusively handled by a strict synthetic service. There is no real fetch fallback, real API credential, remote Cloudflare data or deployed write.

## Run
With the existing Node22 environment and Worker development dependencies installed:

```sh
cd /workspace/shoot-sunday-sync
/workspace/.setup/node_modules/node/bin/node scripts/run-workerd-production-storage.mjs
```

The script uses esbuild/Miniflare/workerd already supplied by the existing Wrangler development installation. It deliberately uses a run-* filename so the normal node --test phase can run BEFORE npm install without loading those tools. CI .github/workflows/ci.yml invokes it after its existing dependency install/dry-run step, preserves its exit status with pipefail and retains the synthetic result log. No deploy workflow is changed.

Runtime startup/request/disposal/polling are bounded; an overall180-second watchdog and a CI5-minute step limit prevent indefinite waits. Each scenario owns a temporary path, stops all runtimes and removes its artifacts. Evidence is printed as safe JSON plus named pass lines. Persist paths must remain in the real OS temporary tree; aliased ancestors are rejected before directory creation.

## Cases and actual storage proof
- needs_decision survives a runtime stop/recreation with the same path. A draw decision completes only remaining work; completed progress survives a second restart and stale original-plan starts are refused409 without replay.
- A committed goal followed by ACK loss leaves blocked event progress and pending/consumed signature journal. Restart preserves both; inspection and duplicate starts never repeat the goal.
- Concurrent same-request starts create one batch.
- Concurrent DIFFERENT request IDs select one owner; the loser receives409 job_exists and cannot overwrite progress before or after restart.

Both BatchJob and WriteGate must have real64-hex-named SQLite state files with SQLite format3 headers, not merely metadata databases. Public responses, owner/request identity, official readback and mutation counts are also checked across restart; the synthetic upstream model remains in Node memory while the actual Worker runtimes are recreated.

## Runtime compatibility and limits
The verified local versions are Node22.23.4, esbuild0.28.2, Miniflare5.20261023.3-beta and workerd1.20261023.1. Miniflare5 is configured through its supported convertV4MiniflareOptions helper when present. Both resourcePersistencePath and isolatedResourcePersistencePath point to the same temporary root so conversion cannot discard persistence; scriptPath/modulesRoot share that root to avoid module path escape. There is no application entrypoint/config rewrite.

This proves local workerd plus SQLite persistence. It does NOT prove GitHub-hosted CI, Cloudflare remote storage semantics, real device Safari or a live SpoSched mutation. See docs/workerd-local-evidence-20261031.json for durable local evidence. Independent review reran all four cases successfully. Actual app src, wrangler.jsonc and dependency declarations were unchanged.
