---
summary: "Fail-closed startup and operations contract for disposable Weaver cells"
read_when:
  - Operating or debugging Weaver cells
  - Implementing the RuntimeProfile verifier/projector or cell orchestrator
  - Collecting Docker, Kubernetes, recovery, or readiness evidence
title: "Weaver operations"
---

# Weaver Operations

Status: deferred managed-cell runbook. Only the launch guard and repository checks are executable.
Weave's current release does not require Agent Runtime Control, private cells, Runners, or the
external stores below. This is a future candidate, not the operator path for the standalone
product. Lifecycle, authorization and infrastructure requirements need separate evidence.

## Supported entrypoint

Invoke the existing guard directly. The v2026.9.8 reconstruction removes downstream root package
aliases so upstream package metadata and dependency inputs remain unchanged.

```bash
node scripts/weaver/launch-from-runtime-profile.mjs \
  --profile /run/weaver/input/runtime-profile.json \
  --projector /usr/local/bin/weave-runtime-profile-projector \
  --ephemeral-root /run/weaver/cell \
  --config /run/weaver/cell/generated/openclaw.json \
  --state-dir /run/weaver/cell/state \
  --workspace /run/weaver/cell/workspace \
  --cell-ref cell:example \
  --workload-client-id weaver-cell-example \
  -- gateway
```

Profile and projector must be absolute regular non-symlink files. The projector is an executable
selected by the immutable cell image, never by the profile. Config, state and workspace are inside
the declared ephemeral root. Restore state/workspace before launch; generated config must not exist.
Use `--check` instead of `-- gateway` to verify/write config without starting the runtime.

Managed cells do not use interactive `openclaw onboard`, `setup`, `configure`, or hand-edited
member config. The image must contain a fresh build of the pinned upstream commit. Verify image
build provenance against the policy; stale local build output is not release evidence.

## Verifier and projector protocol

The wrapper executes the projector directly, without a shell:

```text
<projector> --profile <absolute-profile-path>
            --state-dir <absolute-ephemeral-state-path>
            --workspace <absolute-ephemeral-workspace-path>
            --cell-ref <exact-cell-reference>
            --workload-client-id <cell-client-id>
```

It must emit exactly one UTF-8 JSON object:

```json
{
  "protocolVersion": "weaver.profile-projection/v2",
  "contractVersion": "weave.runtime-profile/v2",
  "profileId": "rp_example",
  "cellRef": "cell:example",
  "workloadClientId": "weaver-cell-example",
  "profileSha256": "sha256:<64 lowercase hex characters>",
  "signatureVerified": true,
  "disabledCapabilities": ["mcp"],
  "openclawConfig": {}
}
```

The hash covers exact received profile bytes. Nonzero exit, timeout, invalid/oversize output,
wrong digest/binding, v1 input, unknown envelope fields or missing verification fails before launch.
The projector validates the canonical profile schema, subject/cell binding, issuer, signature,
expiry, entitlement revision, revocation, workspace revision, RuntimeState generation, fencing
epoch and policy limits. It emits SecretRefs, never literal secrets. Support-safe diagnostics go
to stderr. No unsigned fallback, embedded trust-key replacement or last-known-good acceptance.

## Generated config gate

The guard requires the declared workspace, one enabled HTTPS Matrix channel with encryption and
SecretRef access token, no Matrix password or additional account, no other channel and no MCP
projection. The projector also owns model, sandbox, network, allowed-room, tool and native-approval
policy. The guard's narrower structural validation supplements that authority; it does not replace it.

MCP stays disabled pending the full client-credentials, exact-resource and ARC/member binding proof.
Do not substitute a human OAuth flow, shared service account, static header or upstream feature claim.

## Lifecycle ordering

Before launch the orchestrator must:

1. Check current entitlement and acquire a per-person lease with a new fencing epoch.
2. Verify the signed RuntimeProfile through the trusted projector.
3. Restore a completed encrypted RuntimeState generation.
4. Verify and atomically activate the immutable WebDAV WorkspaceRevision.
5. Broker short-lived Matrix/model/storage credentials as SecretRefs.
6. Launch the guard and expose only the proven slice as ready.

On stop: drain work, flush SQLite WAL, publish and verify an encrypted checkpoint, commit allowed
workspace changes with HEAD compare-and-swap, revoke credentials, release the lease, and destroy
local cell files. Lease loss or entitlement revocation fences writes and side effects before shutdown.

RuntimeState checkpoints default to 30-day retention. User-visible workspaces follow explicit
deletion/organization retention. Session reset, RuntimeState reset, Matrix device rotation,
credential revocation, WebDAV deletion and full agent deletion are separate authorized operations.

## Adapter targets

Local dogfood uses rootless Docker/Compose, PostgreSQL Control Store, Nextcloud/WebDAV Workspace
Store, encrypted S3-compatible Runtime State Store, OpenBao/Vault-compatible Secret Broker and
tmpfs or verified disposable filesystems. Prove recovery after deletion of the whole cell filesystem.

Production targets Kubernetes/gVisor, non-root read-only root filesystem, dropped capabilities,
seccomp, quotas, default-deny networking, workload identity and ephemeral `emptyDir`/tmpfs only.
No cell PVC. Require immutable image digests, SBOM/signature checks and protected deployment.
Upstream Docker/Kubernetes examples are not automatically compliant Weaver cells.

## Health, evidence and failure behavior

Diagnostics may include sanitized profile/workspace/runtime-state revisions, lifecycle status,
fencing epoch, dependency readiness, checkpoint/commit times and correlation identifiers. Never
include credentials, signed profile bodies, member content, provider payloads, private paths or
recovery/decryption material.

Ready/production claims require exact-candidate evidence for cell deletion and cross-node recovery,
stale-writer rejection, crash boundaries, Matrix dedupe/E2EE/device recovery, OAuth audience and
workload/member authorization, token exchange/revocation, workspace conflict handling, encrypted
checkpoint migration and rollback, backup/restore/deletion, gVisor isolation, resource/network limits,
SBOM/signature, accessibility and support bundles. Missing required evidence fails closed.

Do not run an older runtime against state migrated by a newer one. Preserve and restore the
matching immutable image and external state generation for rollback. No live state is migrated by
an upstream or licensing pull request.

## Fork and dependency checks

```bash
node scripts/weaver/check-fork-boundary.mjs
pnpm exec vitest run --config scripts/weaver/vitest.config.mjs
pnpm audit --prod --audit-level high
pnpm build
git diff --check
```

The fork check uses the actual UTC date in CI. `WEAVER_FORK_CHECK_DATE` is for deterministic test
fixtures, not for hiding a stale review. It validates the annotated pin, reviewed release, review
freshness, changed paths and budgets. No date advance without reviewing the actual baseline.
