---
summary: "Weave-specific zero-durable-byte cell boundary around upstream OpenClaw"
read_when:
  - Designing Weaver lifecycle, storage, recovery, Matrix or approvals
title: "Stateless Weaver cell architecture"
---

# Stateless Weaver Cell Architecture

Status: target contract. This document does not claim that the repository implements it yet. See the [implementation plan](/architecture/stateless-weaver-cell-implementation-plan) and tracking issues [#32](https://github.com/masssi164/weaver/issues/32) and [#30](https://github.com/masssi164/weaver/issues/30).

Weaver is an upstream-first OpenClaw distribution executed as a stateless, isolated cell for each entitled Weave member. A cell owns no durable bytes and may be killed, moved, upgraded or scaled to zero without copying its filesystem.

## Product boundary

Weave/Keycloak owns entitlement, policy, signed RuntimeProfile, lifecycle orchestration, external state references, MCP authorization, side effects and audit. OpenClaw retains its upstream agent loop, session semantics, Matrix channel, workspace/memory/skill loaders, MCP client and native approvals. Weaver is not a collaboration domain; members reach it through Matrix and governed Weave surfaces.

## External authorities

```text
Keycloak                  subject, groups, entitlement root
Weave Control Store       RuntimeProfile refs, lease/fencing, workspace HEAD,
                          bootstrap marker, wake dedupe/outbox, conflicts, audit
Member Files / WebDAV     AGENTS.md, SOUL.md, USER.md, IDENTITY.md, TOOLS.md,
                          MEMORY.md, memory/**, approved custom skills/**
RuntimeStateStore         versioned encrypted OpenClaw state-dir checkpoint:
                          sessions/SQLite, approvals, plugin/channel state,
                          stable Matrix device and crypto state
Secret Manager / KMS      OAuth/Matrix/provider/DAV credentials, recovery keys,
                          data-encryption keys
Stateless Weaver Cell     generated config, local snapshot + write overlay,
                          caches, processes and short-lived credentials only
```

The first RuntimeStateStore adapter may be an encrypted per-user block volume, but it is externally addressed, exclusively leased and control-plane-owned—not a pod's persistent disk. SQLite, secrets and Matrix crypto state never use WebDAV.

## Cell protocol

1. Verify Keycloak entitlement and signed, unexpired, person/cell-bound RuntimeProfile.
2. Acquire the per-person distributed lease and monotonically increasing fencing epoch.
3. Restore/attach a verified RuntimeState generation; generate `openclaw.json` from RuntimeProfile.
4. Fetch the signed WorkspaceManifest and materialize its immutable WebDAV revision into fresh staging.
5. Validate paths/content/limits; enforce organization overlay and approved-skill hash set; atomically activate a local immutable base plus copy-on-write overlay.
6. Start OpenClaw only after state and workspace are ready. One run pins profile, workspace and skill revisions.
7. Journal allowed workspace writes externally immediately. At turn end, before compaction/response completion and at stop, publish through an `If-Match`/HEAD compare-and-swap commit barrier.
8. On stop, drain work, flush OpenClaw/SQLite WAL, checkpoint external RuntimeState, revoke credentials, release the lease and erase the cell filesystem.
9. On crash or lease loss, reject stale writes and reconstruct the next cell from completed external generations and journal records only.

Lifecycle:

```text
ABSENT → PROVISIONING → STOPPED → ACQUIRING_LEASE → RESTORING → MATERIALIZING
MATERIALIZING → READY ↔ BUSY → COMMITTING → READY
READY/BUSY → STOPPING → COMMITTING → STOPPED
CRASH/LEASE_LOSS → DEGRADED → STOPPED/ACQUIRING_LEASE
ANY → REVOKING → SUSPENDED/STOPPED
STOPPED → RESETTING/DELETING → STOPPED/DELETED
```

## Workspace and memory

The canonical private root is `/dav/files/{personRef}/.weaver/workspace/`. Supported v1 entries are bootstrap Markdown, `MEMORY.md`, dated/sluggified Markdown under `memory/**`, optional `DREAMS.md`/imports, and approved workspace skills. Raw transcripts are not memory by default. Private `MEMORY.md` is never injected into shared/group execution without an explicit safe-projection policy.

Workspace skills have OpenClaw's highest precedence. V1 therefore allows `SKILL.md` and approved text/JSON/YAML resources only; binaries, archives, symlinks, plugins and shadowing of reserved/managed skills are blocked. Activation requires scan, allowlist/signature, hash binding and a new WorkspaceRevision. Skill text cannot expand tools, sandbox or network policy.

## Approvals and actions

OpenClaw native plugin/exec approvals own request state and Matrix delivery. MCP elicitation owns protocol interaction. Weave reauthorizes every domain action and atomically consumes argument-bound evidence/idempotency state. No second Weaver approval inbox exists. Approval state, event dedupe and action idempotency survive cell replacement outside the cell.

## Deletion and recovery

Session reset, RuntimeState reset, Matrix device rotation/logout, credential revoke and WebDAV workspace/memory delete are distinct operations. E2EE-destructive actions require step-up confirmation, explicit loss warning and recovery check. Loss of crypto state creates a new device/reverification workflow; continuity is never fabricated.

## Upstream-first fork budget

No custom agent loop, Matrix channel, approval engine, memory/skill loader or MCP protocol. Any core patch requires an upstream gap, isolated test, owner, removal criterion and tracked drift budget. Runtime upgrades use a copy-on-write state migration, upstream health/doctor checks and rollback checkpoint.

## Readiness proof

- complete cell deletion and reconstruction on another node;
- split-brain/fencing and crash-at-every-stage tests;
- durable `AGENTS.md`, memory and approved skill across scale-to-zero;
- no SQLite/token/recovery key/generated config in WebDAV, profiles, logs or support bundles;
- stable Matrix device and recovery behavior;
- stale entitlement/profile/workspace/lease and duplicate Matrix event fail closed;
- upstream OpenClaw upgrade and rollback without old-container migration.
