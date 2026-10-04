---
summary: "Thin-fork architecture for Weave-governed disposable OpenClaw cells"
read_when:
  - Designing Weaver identity, startup, Matrix, MCP, approvals, storage, or isolation
  - Reviewing whether a change belongs in Weaver, Weave, or upstream OpenClaw
title: "Weaver architecture"
---

# Weaver Architecture

Status: deferred design reference. The current Weave release is the standalone collaboration
product described in [the Weaver README](https://github.com/masssi164/weaver#readme) and
[Weave epic #1470](https://github.com/masssi164/weave/issues/1470). Broad Agent Runtime Control,
private cells, external state authorities, workflows and Runners are outside that release. The
repository contains a bootstrap guard and fork-policy evidence, but no deployed cell-control
system. The proposals below are not current release acceptance criteria.

## Ownership

This document explores a possible managed-cell implementation for optional Weaver deployment.
Weaver is not a collaboration domain or an identity, authorization, or data plane.

| Owner                 | Responsibilities                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keycloak              | Identity system of record, federation/brokering, organizations, coarse roles, and Weaver entitlement                                                |
| Agent Runtime Control | Signed RuntimeProfile desired state, lifecycle, lease/fencing, revocation, workspace/runtime-state references, health, and support-safe correlation |
| Upstream OpenClaw     | Agent loop, sessions, official Matrix plugin, outbound MCP client, memory/skills, and native approval state                                         |
| Weave domains         | Current user/workload authorization, object and argument validation, provider side effects, idempotency, and immutable ActionEvidence               |
| Cell orchestrator     | Disposable compute, ephemeral filesystem, network policy, workload identity, resource limits, and teardown                                          |

A RuntimeProfile configures the maximum runtime capability. It never grants a Files, Calendar,
Chat, Calls, or other domain permission. An OpenClaw approval records a human runtime decision; it
also never substitutes for current domain authorization.

## Identity and protocol path

This is one self-hosted provider arrangement, not a mandatory Weave topology. Keycloak is the
current self-hosted identity default; supported OIDC/OAuth sources and distinct audience-bound
Weave and Matrix sessions remain the product boundary. The cell uses the official
OpenClaw Matrix plugin and a SecretRef-backed credential, not a Keycloak password, OIDC ID token
or southbound provider configuration.

Each RuntimeProfile v2 binds one dedicated Keycloak service account to one cell. The intended MCP
client-credentials path resolves the signed profile's member binding server-side and exchanges,
rather than relays, the workload token for a narrower backend token. The service account never
becomes the member. Public-client, generic service-account, shared-client and human bearer tokens
have no MCP path.

**MCP remains disabled in this distribution.** The v2026.9.8 upstream update does not establish the
ARC binding and authorization proof. Interactive OAuth, static headers and fork-local credential
shims are not substitutes. This restriction is not a claim about the current upstream feature set.

## RuntimeProfile-only startup

The cell entrypoint is `scripts/weaver/launch-from-runtime-profile.mjs`. It does not implement
signature cryptography. An immutable orchestrator-selected executable verifies the profile and
emits the temporary `weaver.profile-projection/v2` envelope described in
[Weaver operations](/weaver/operations#verifier-and-projector-protocol).

The guard rejects missing, relative, symlinked or non-ephemeral paths; binds the projector assertion
to the SHA-256 digest of the exact profile bytes; matches RuntimeProfile v2, profile ID, cell and
workload client; requires one encrypted Matrix channel; rejects literal credentials, other channels
and MCP projection; writes config once with mode `0600`; and launches the stock upstream gateway.

The canonical corpus defines flattened EdDSA JWS over RFC 8785 JCS RuntimeProfile v2. The external
projector remains temporary implementation plumbing until ARC proves signer discovery, key
rotation/revocation, clock/replay policy and deterministic projection. The wrapper is not a second
trust system and accepts no v1 input.

## Four external authorities

- **Control Store:** desired state, lease/fencing epoch, workspace HEAD, wake dedupe/outbox,
  conflicts, idempotency and audit references.
- **Workspace Store:** immutable signed WebDAV workspace revisions and member-visible approved resources.
- **Runtime State Store:** encrypted complete OpenClaw state generations, including SQLite/session state,
  native approvals, plugin/channel state, Matrix crypto state and relevant MCP OAuth state.
- **Secret Broker:** Matrix/model/storage credentials, recovery material and KMS keys.

Local generated config, restored runtime state, workspace overlays and caches are disposable;
they are never canonical durable storage. Initial adapter targets are PostgreSQL, Nextcloud/WebDAV,
MinIO/S3-compatible encrypted generations and OpenBao/Vault-compatible secret services behind ports.
Local dogfood targets rootless Docker; production evidence targets Kubernetes with gVisor.
Runtime-provider choice cannot redefine Matrix, WebDAV, MCP or Weave-domain contracts.

Every durable write, workspace commit, RuntimeState checkpoint and lifecycle report carries the
current monotonically increasing fencing epoch. Stale cells cannot commit. Memory retention may
be reported only after an external journal append or immutable workspace revision succeeds.

## Workspace, memory and skills

WebDAV holds only allowlisted portable content: bootstrap Markdown, private Markdown memory and
reviewed text/Markdown/JSON/YAML skill resources. A signed WorkspaceManifest binds revision,
ETags/hashes, owner, content class, write policy, size limits, approved skill hashes and signature.

SQLite, raw sessions, credentials, Matrix crypto/device state, plugin state and generated config
never belong in WebDAV. Materialization rejects traversal, links, devices, archives, binaries,
plugins, reserved-name shadowing, undeclared egress and skill attempts to expand execution policy.

## Approvals and side effects

OpenClaw owns plugin/exec approvals, Matrix delivery, decisions, timeout, cancellation and bounded
remembered grants. MCP owns elicitation. Weave revalidates the server-resolved member binding,
current identity/entitlement, authenticated workload, organization policy, object scope, canonical
arguments, expiry and revocation immediately before any provider operation.

The target contract binds signed, short-lived, single-use ApprovalDecisionEvidence v2 to the exact
challenge, arguments, principals, cell, profile, policy and expiry. The receiving domain independently
authorizes, atomically consumes allow-once evidence and appends immutable ActionEvidence v2. Neither
is member authority. Weaver adds no parallel approval inbox or v1 reader. These are proof-gated
integration requirements, not features inferred from a passing distribution test.

## Fork boundary

No core patch or Weaver-owned plugin is approved. The policy permits only declared distribution
entry points, docs, guard, checks and focused tests. Any exception must be explicit, bounded,
upstream-tracked, owned and removable. A successful fork check proves repository shape, not live
security, durability, interoperability or production readiness.
