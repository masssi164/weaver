---
summary: "Thin-fork architecture for Weave-governed disposable OpenClaw cells"
read_when:
  - Designing Weaver identity, startup, Matrix, MCP, approvals, storage, or isolation
  - Reviewing whether a change belongs in Weaver, Weave, or upstream OpenClaw
title: "Weaver architecture"
---

# Weaver Architecture

Status: target architecture. The repository contains a bootstrap guard and fork-policy evidence;
it does not yet prove the runtime, infrastructure, or production-readiness claims below.

## Ownership

Weaver is the first runtime implementation behind Weave's Agent Runtime Control bounded context.
It is not a collaboration domain and it is not an identity, authorization, or data plane.

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

```text
external LDAP/AD/OIDC/SAML
             |
             v
         Keycloak  -------- entitlement/profile authority
          |    |
          |    +----> Matrix Authentication Service ---> Matrix facade
          |                                             (official OpenClaw plugin)
          |
          +---- delegated user OAuth token ---> Weave MCP edge
                                                   |
                                      workload service account + token exchange
                                                   |
                                                   v
                                           authorized Weave domain
```

Keycloak is mandatory infrastructure. External identity systems connect upstream through user
federation or identity brokering; they do not replace Keycloak. Matrix Authentication Service is
the Matrix-facing authorization server with Keycloak upstream. The cell uses the official OpenClaw
Matrix plugin and a SecretRef-backed Matrix credential; it does not receive a Keycloak password,
OIDC ID token, or southbound provider configuration.

RuntimeProfile projects remote Streamable HTTP MCP servers through upstream `mcp.servers` with
`auth: "oauth"`. Member-domain calls require active delegated user authority. The MCP edge uses its
own confidential workload/service-account identity and exchanges the user token for the backend
audience. A client-credentials token alone is restricted to workload lifecycle/readiness calls and
cannot impersonate a member. Incoming bearer tokens are never relayed unchanged to a domain.

## RuntimeProfile-only startup

The cell entrypoint is `scripts/weaver/launch-from-runtime-profile.mjs`. It does not implement
signature cryptography. Instead, an immutable orchestrator-selected executable must verify the
profile and emit the temporary `weaver.profile-projection/v1` envelope documented in
[Weaver operations](/weaver/operations#verifier-and-projector-protocol).

The guard then:

1. rejects missing, relative, symlinked, or non-ephemeral runtime paths;
2. correlates the projector assertion with the SHA-256 digest of the exact profile bytes;
3. requires a stock OpenClaw configuration with one encrypted Matrix channel, SecretRef-backed
   Matrix credentials, and HTTPS/OAuth Streamable HTTP MCP servers;
4. rejects literal credential values and any additional enabled message channel;
5. writes `openclaw.json` once with mode `0600` inside the declared ephemeral root;
6. launches upstream `openclaw.mjs gateway` with fixed config and state paths.

This split is fail-closed but temporary. The canonical specification must still define signed
bytes or a signed-envelope format, algorithm agility, trust-root discovery, key rotation,
revocation, clock-skew, and version negotiation before the projector can become a standardized
cross-repository contract.

## Four external authorities

```text
Control Store       PostgreSQL desired state, lease/fencing epoch, workspace HEAD,
                    wake dedupe/outbox, conflicts, idempotency and audit references

Workspace Store     immutable signed WebDAV workspace revisions and member-visible
                    Markdown/approved skill resources

Runtime State Store encrypted complete OpenClaw state generations: SQLite/session state,
                    native approvals, MCP OAuth state, plugin/channel state, Matrix crypto state

Secret Broker       Matrix/model/storage credentials, recovery material, KMS keys

Disposable cell     generated config, restored runtime state, materialized workspace/COW
                    overlay, caches and processes; no canonical durable bytes
```

The initial self-hosted adapters are PostgreSQL, Nextcloud/WebDAV, MinIO/S3-compatible encrypted
generations, and OpenBao/Vault-compatible secret/KMS services. These products stay behind ports.
Local dogfood uses a rootless Docker orchestrator adapter; production evidence targets Kubernetes
with gVisor. The runtime-provider choice cannot change Matrix, WebDAV, MCP, or Weave domain
contracts.

Every durable write, workspace commit, RuntimeState checkpoint, and lifecycle report carries the
current monotonically increasing fencing epoch. A stale cell must be unable to commit even if its
process remains alive. A response may claim that memory was retained only after an external journal
append or immutable workspace revision commit succeeds.

## Workspace, memory, and skills

WebDAV is canonical only for allowlisted portable content: bootstrap Markdown, private Markdown
memory, and reviewed text/Markdown/JSON/YAML skill resources. A signed WorkspaceManifest binds the
immutable revision, ETags/hashes, owner, content class, write policy, size limits, approved skill
hash set, and signature.

SQLite, raw sessions, credentials, Matrix crypto/device state, plugin state, and generated config
never belong in WebDAV. Materialization rejects traversal, links, devices, archives, binaries,
plugins, reserved-name shadowing, undeclared egress, and any skill content that attempts to expand
tools, sandbox, or network policy.

## Approvals and side effects

OpenClaw remains the only owner of open plugin/exec approvals, Matrix delivery, decisions, timeout,
cancellation, and bounded remembered grants. MCP owns elicitation. Weave revalidates current
Keycloak identity, entitlement, user rights, workload identity, organization policy, object scope,
canonical arguments, expiry, and revocation immediately before a provider operation.

Weave may record immutable ActionEvidence correlated to the OpenClaw approval, exact argument
digest, policy/tool/profile revisions, nonce, result, and audit reference. ActionEvidence is neither
an open workflow nor reusable authority. Weaver has no custom approval inbox or parallel receipt
state machine.

## Fork boundary

The initial fork budget permits no core patch and no Weaver-owned plugin. `weaver.fork-policy.json`
allows only the distribution entry point, these docs, the launch guard, its focused tests, and the
fork checker. Any future exception must be explicit, bounded, upstream-tracked, owned, and
removable. A successful fork check is repository-shape evidence only; it proves no live security,
durability, interoperability, or readiness claim.
