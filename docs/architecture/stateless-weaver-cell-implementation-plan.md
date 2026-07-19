---
summary: "Implementation sequence and evidence gates for disposable Weaver cells"
read_when:
  - Implementing Weaver cell lifecycle, state, workspace, Matrix or approvals
title: "Stateless Weaver cell implementation plan"
---

# Stateless Weaver Cell Implementation Plan

Status: proposed implementation sequence. This document defines work; it does not claim that any item is implemented.

Architecture: [Stateless Weaver cell architecture](/architecture/stateless-weaver-cell). Related issues: [#32](https://github.com/masssi164/weaver/issues/32) and [#30](https://github.com/masssi164/weaver/issues/30).

## Mission

Run one upstream-first OpenClaw cell for each entitled Weave member while making the cell disposable. Deleting a cell, including its filesystem, must not delete acknowledged memory, sessions, approval state, Matrix device continuity, pending wake work or audit evidence. A replacement cell on another node reconstructs only from external authorities.

## Binding constraints

- A cell owns zero durable bytes. Pod-bound or cell-local persistent storage is not canonical.
- Do not fork the OpenClaw agent loop, session semantics, Matrix channel, workspace/memory/skill loaders, MCP protocol or native approval engine.
- RuntimeProfile is signed desired state, not authorization. Weave reauthorizes every MCP side effect at execution time.
- WebDAV stores the member-owned workspace and Markdown memory, never SQLite, credentials, raw sessions or Matrix crypto state.
- The complete version-pinned `$OPENCLAW_STATE_DIR` is restored and checkpointed through an encrypted RuntimeStateStore.
- One run pins the RuntimeProfile, WorkspaceRevision, approved skill-set hash, RuntimeState generation, lease and fencing epoch.
- A response may claim durable memory only after an external journal append or WebDAV revision commit succeeds.

## Contract first

Before runtime code, publish and validate versioned contracts for:

1. `RuntimeProfile`: subject/cell binding, entitlement reference, expiry, policy/tool set, workspace manifest reference, runtime-state reference, lease/fencing data and secret references only.
2. `WorkspaceManifest`: immutable revision, authoritative HEAD, file ETags and hashes, owner/data class/write policy, size/content type, skill metadata, signature and skill-set hash.
3. `RuntimeStateCheckpoint`: OpenClaw version/state-schema version, encrypted generation, parent generation, inventory digest, fencing epoch, completeness marker, created-at and KMS key reference.
4. Lifecycle commands and events with closed state and reason-code enums.

Malformed, expired, unsigned, cross-subject, stale-epoch and unknown-incompatible versions fail closed. Generated `openclaw.json` is an ephemeral projection and never the source of truth.

## Workstream 1: storage ports and inventory

- Define narrow ports for `ControlStore`, `WorkspaceStore`, `RuntimeStateStore`, `SecretBroker` and cell-local ephemeral storage.
- Inventory every durable path written by the pinned OpenClaw version under `$OPENCLAW_STATE_DIR`; classify sessions/SQLite, native approvals, plugin/channel state, Matrix device/crypto state and migration metadata.
- Add an automated inventory drift test that fails an OpenClaw upgrade when an unclassified durable path appears.
- Permit an encrypted per-user block-volume adapter only when it is externally addressed, control-plane-owned, exclusively leased and replaceable behind `RuntimeStateStore`.

Exit evidence: contract tests for each port, state inventory artifact, encryption/key-reference proof and a repository scan showing no durable path rooted in the cell.

## Workstream 2: lease, fencing and lifecycle

Implement the closed lifecycle:

```text
ABSENT -> PROVISIONING -> STOPPED -> ACQUIRING_LEASE -> RESTORING -> MATERIALIZING
MATERIALIZING -> READY <-> BUSY -> COMMITTING -> READY
READY/BUSY -> STOPPING -> COMMITTING -> STOPPED
```

Add fail-closed `DEGRADED`, `REVOKING`, `SUSPENDED`, `RESETTING` and `DELETING` paths.

- Acquire one exclusive per-person lease with a monotonically increasing fencing epoch.
- Carry the epoch on every control write, workspace journal/HEAD commit, RuntimeState checkpoint and lifecycle report.
- Reject stale writers even if the old process remains alive.
- Make entitlement revocation win races: fence the old lease, block new work and side effects, revoke credentials, preserve only policy-permitted recovery state, then stop compute.
- Make wake delivery externally durable and deduplicated before starting a cell.

Exit evidence: split-brain, lease-expiry, delayed-writer, revocation-at-each-state and exactly-once wake tests.

## Workstream 3: RuntimeState restore and checkpoint

- Restore only a verified, completed checkpoint generation compatible with the pinned OpenClaw version.
- Stage decryption and integrity verification before exposing state to OpenClaw.
- Start OpenClaw only after the RuntimeState generation and workspace revision are both ready.
- At a checkpoint barrier, drain or cancel work, flush OpenClaw and SQLite WAL, create an encrypted copy-on-write generation, verify it, atomically publish the completed generation and advance the active reference with fencing.
- Keep the prior complete generation for bounded rollback.
- Upgrade state through copy-on-write migration plus `openclaw doctor`/health validation. Never mutate the only good generation in place.

Exit evidence: wrong-key, corruption, interrupted-upload, rollback, version-migration and cross-node reconstruction tests.

## Workstream 4: immutable WebDAV workspace

Canonical member root: `/dav/files/{personRef}/.weaver/workspace/`.

- Treat direct WebDAV edits as drafts until validated and activated.
- Materialize a signed immutable WorkspaceManifest into a fresh staging directory using a short-lived materializer-only DAV credential.
- Reject absolute/traversal paths, symlinks, hardlinks, devices, FIFOs, sockets, case-fold collisions, reserved-name shadowing, public shares, forbidden content and quota excess.
- Verify signature, ETags and SHA-256 hashes; atomically activate an immutable local base plus per-run copy-on-write overlay.
- Publish permitted writes into a new draft revision with ETag preconditions; validate/sign it and advance authoritative Control Store HEAD by compare-and-swap.
- Preserve conflict copies and enter `DEGRADED`; never silently overwrite remote changes.

Supported member-owned v1 content includes OpenClaw bootstrap Markdown, `MEMORY.md`, `memory/**`, optional reviewed imports and approved `skills/**`. Raw transcripts are not memory by default.

Exit evidence: partial transfer, ETag race, path attack, quota, conflict recovery and mid-run-drift tests.

## Workstream 5: durable journal and commit barriers

- Append allowed workspace mutations and recovery intent to an encrypted external journal immediately.
- Require barriers at turn end, before compaction, before completing a response that claims something was remembered, at graceful stop, upgrade and scale-to-zero.
- Make journal records idempotent and bound to subject, run, workspace base revision, checkpoint generation and fencing epoch.
- Replay only records newer than the last completed external generations.
- If no external authority can accept the write, return a visible degraded result instead of a false durability claim.

Exit evidence: kill injection at every append/commit/checkpoint boundary with no acknowledged-memory loss.

## Workstream 6: private memory and approved skills

- Preserve upstream Markdown memory and rebuildable local indexes; do not create a competing memory engine.
- Inject private `MEMORY.md` and daily memory only in the member's private main context. Shared/group rooms require an explicit safe projection and never receive private memory by default.
- Apply retention, export and deletion policy by data class.
- For the v1 custom-skill pilot, allow reviewed `SKILL.md` and allowlisted Markdown/text/JSON/YAML resources only.
- Reject executable content, binaries, archives, native code, symlinks and uploaded OpenClaw plugins.
- Quarantine, scan, hash, sign, version and approve before activation. Block collisions with managed, bundled and reserved skills.
- Prove skill content cannot expand RuntimeProfile tools, sandbox or network policy.

Exit evidence: cross-user/group isolation, malicious skill, shadowing, signature/hash and policy-expansion negative tests.

## Workstream 7: Matrix wake and OpenClaw native approvals

- Use the official OpenClaw Matrix plugin against the Weave Matrix facade; do not add a custom `weave-chat` channel.
- Keep stable Matrix device and crypto state in RuntimeStateStore and credentials/recovery material in Secret Manager.
- Persist Matrix event dedupe, wake outbox and native approval state outside the cell so replacement cannot duplicate a decision or action.
- Let OpenClaw own `plugin.approval.*`/exec approval lifecycle, Matrix delivery, decision routing, timeout and cancellation.
- Let MCP own invocation and elicitation. Let Weave own current OAuth audience checks, entitlement/RBAC/ABAC, risk policy, canonical argument/object binding, idempotent side effect and immutable evidence.
- Start with `allow-once` and `deny` for externally consequential actions. Add durable trust only through a separately reviewed bounded policy with list/revoke UX.

Exit evidence: allow/deny/timeout/no-route/replay/argument-mutation/group-revocation tests and proof that no second member-facing approval inbox exists.

## Workstream 8: reset, deletion and recovery

Implement independently authorized and audited operations for session reset, RuntimeState reset, Matrix device rotation/logout, credential revocation, WebDAV memory deletion and complete personal-agent-data deletion.

Runtime reset must not delete WebDAV memory. E2EE-destructive actions require step-up authentication, an explicit irreversibility warning and a recovery/backup check. Lost Matrix crypto state creates a new device and reverification flow; continuity is never fabricated.

Exit evidence: scope-isolation tests for every operation and an operator recovery drill.

## Delivery sequence

1. Documentation and versioned schemas; mark old custom-chat and pod-persistence assumptions superseded.
2. Storage ports, OpenClaw state inventory and in-memory/fake contract adapters.
3. ControlStore lease/fencing and lifecycle reconciler.
4. RuntimeState encrypted checkpoint adapter and cross-node restore proof.
5. Workspace manifest, materializer, write journal and HEAD compare-and-swap.
6. Skill quarantine/activation and private-memory projection policy.
7. Matrix wake/dedupe plus official native approval integration with Weave MCP.
8. Reset/deletion/recovery flows, upgrade/rollback and production runbooks.

Each implementation PR must link a requirement above, include positive/negative/race/crash tests, state migrations and rollback, support-safe telemetry, and list any retained legacy path with owner and deletion criterion. Keep code changes separate from this documentation-only proposal.

## Definition of done

- A busy cell is deleted and reconstructed on another node without reading any old cell filesystem.
- Acknowledged memory, sessions, native approvals and Matrix continuity meet the documented recovery contract.
- Two cells cannot both commit after lease failover.
- WebDAV/profile/log/support scans contain no SQLite, token, recovery key, raw session or generated configuration.
- Member/group removal blocks wake, new work and MCP side effects without waiting for profile expiry.
- An upstream OpenClaw upgrade and rollback passes state-inventory, doctor, health and interoperability tests without a core subsystem fork.
- Runbooks cover degraded workspace/state stores, split brain, key loss, Matrix device loss, conflicts, reset and deletion.
- No readiness claim is made from documentation, schemas, mocks or unit tests alone; reproducible cross-node and real Matrix evidence is required.
