---
summary: "Fail-closed startup and operations contract for disposable Weaver cells"
read_when:
  - Operating or debugging Weaver cells
  - Implementing the RuntimeProfile verifier/projector or cell orchestrator
  - Collecting Docker, Kubernetes, recovery, or readiness evidence
title: "Weaver operations"
---

# Weaver Operations

Status: target runbook. Only the local launch guard and repository fork checks are executable in
this slice. Commands marked as evidence requirements need the corresponding Agent Runtime Control
and infrastructure adapters before they can support a readiness claim.

## Supported entrypoint

Managed cells start only through the wrapper:

```bash
pnpm weaver:launch -- \
  --profile /run/weaver/input/runtime-profile.json \
  --projector /usr/local/bin/weave-runtime-profile-projector \
  --ephemeral-root /run/weaver/cell \
  --config /run/weaver/cell/generated/openclaw.json \
  --state-dir /run/weaver/cell/state \
  --workspace /run/weaver/cell/workspace \
  -- gateway
```

The profile and projector must be absolute, regular, non-symlink paths. The projector must be an
executable selected from the immutable cell image, not a profile-controlled command. Config, state,
and workspace paths must be inside the explicit ephemeral root. State and workspace must already be
restored/materialized before launch. The generated config path must not exist.

Use `--check` instead of `-- gateway` to verify projection and write the generated config without
starting OpenClaw. A successful check proves only the bootstrap boundary.

Interactive `openclaw onboard`, `setup`, `configure`, and hand-edited member configuration are not
supported managed-cell entrypoints. Upstream commands remain available to upstream developers, but
the Weaver container entrypoint and workload policy expose only this wrapper.

The immutable cell image must contain a fresh build of the pinned upstream commit. Image CI must
match `dist/build-info.json` to `weaver.fork-policy.json`; ignored artifacts left by another source
branch are not runtime or release evidence.

## Verifier and projector protocol

The wrapper executes the projector directly without a shell:

```text
<projector> --profile <absolute-profile-path>
            --state-dir <absolute-ephemeral-state-path>
            --workspace <absolute-ephemeral-workspace-path>
```

The projector must emit exactly one UTF-8 JSON object on stdout and may emit support-safe diagnostics
on stderr:

```json
{
  "protocolVersion": "weaver.profile-projection/v1",
  "profileSha256": "sha256:<64 lowercase hex characters>",
  "signatureVerified": true,
  "openclawConfig": {}
}
```

The SHA-256 value covers the exact profile file bytes received by the wrapper. Exit non-zero,
timeout, invalid/oversize output, a different digest, `signatureVerified` other than `true`, unknown
envelope keys, or invalid OpenClaw config fails before the config file or runtime is created.

The projector is the temporary trust boundary. It must validate the canonical RuntimeProfile
schema, subject/cell binding, issuer, signature, expiry, entitlement revision, revocation, workspace
revision, RuntimeState generation, lease/fencing epoch, and policy limits before emitting config. It
must resolve no secret value into stdout; generated config contains only supported OpenClaw
SecretRefs.

The temporary protocol can be replaced only after the canonical Weave specification defines:

- the signed bytes or signed-envelope serialization and algorithm identifiers;
- trust-root discovery, allowed issuers/signers, rotation, revocation, and recovery;
- clock-skew, expiry, replay, profile-version negotiation, and unknown-field handling;
- the deterministic RuntimeProfile-to-OpenClaw projection and conformance fixtures;
- workload attestation and the projector binary/image provenance contract.

Until then, never add local canonicalization, embedded trust keys, unsigned development fallback, or
"last known good" profile acceptance to the wrapper.

## Generated config gate

The wrapper accepts only a narrow stock OpenClaw projection:

- `agents.defaults.workspace` equals the declared ephemeral workspace;
- `channels.matrix` is the sole configured channel, is enabled, uses HTTPS, requires encryption,
  and references its access token through an OpenClaw SecretRef;
- every enabled `mcp.servers` entry uses HTTPS Streamable HTTP with `auth: "oauth"`;
- MCP configuration has no command/stdio transport, static headers, URL query credentials, or TLS
  verification bypass;
- credential-shaped config fields contain SecretRefs, never literal values.

The projector additionally owns model, sandbox, network, allowed room, allowed tool, native
approval, and operator-support projection according to the signed profile. The wrapper's narrow
structural check is defense in depth, not a second policy engine.

## Lifecycle ordering

A cell orchestrator performs these steps before invoking the wrapper:

1. read current Keycloak entitlement and acquire one per-person lease with a new fencing epoch;
2. fetch and verify the signed RuntimeProfile through the trusted projector boundary;
3. restore one completed, encrypted RuntimeState generation into the ephemeral state directory;
4. materialize and atomically activate the signed immutable WebDAV WorkspaceRevision;
5. broker supported short-lived Matrix, model, storage, and KMS credentials as SecretRefs; keep
   upstream-managed MCP OAuth refresh material only in encrypted RuntimeState;
6. run the wrapper and declare `READY` only after stock OpenClaw health plus Matrix/MCP probes pass.

On stop, the orchestrator drains work, flushes SQLite WAL, publishes and verifies an encrypted
checkpoint generation, commits allowed workspace writes with HEAD compare-and-swap, revokes
credentials, releases the lease, and destroys the cell filesystem. Lease loss or entitlement
revocation fences writes and side effects before shutdown.

RuntimeState checkpoints default to 30-day retention. User-visible workspaces remain until explicit
deletion or organization retention policy. Session reset, RuntimeState reset, Matrix device
rotation, credential revocation, WebDAV deletion, and complete personal-agent deletion are separate
authorized operations.

## Adapter profiles

### Local dogfood

- rootless Docker/Compose cell orchestration;
- PostgreSQL Control Store;
- Nextcloud/WebDAV Workspace Store;
- MinIO S3-compatible Runtime State Store with envelope encryption;
- OpenBao/Vault-compatible Secret Broker;
- tmpfs or a verified disposable container filesystem for the cell.

The upstream Docker examples use persistent host mounts and are therefore not a Weaver cell
contract. A local adapter must override those defaults and prove that canonical state reconstructs
from the four external authorities after the entire container filesystem is deleted.

### Production evidence target

- Kubernetes controller/operator implementing the same CellOrchestrator port;
- gVisor `RuntimeClass`, non-root user, read-only root filesystem, dropped capabilities, seccomp,
  resource quotas, and default-deny NetworkPolicy;
- ephemeral `emptyDir`/tmpfs only for generated config, restored state, workspace overlay, and
  caches; no PersistentVolumeClaim mounted into a cell;
- workload identity for Control/Workspace/RuntimeState/SecretBroker access;
- immutable image digests, SBOM, signature/provenance verification, and protected deployment
  environments.

Upstream's Kubernetes guide explicitly describes a minimal, non-production starting point and uses
a persistent volume. Do not present it as Weaver production evidence or copy its PVC into the cell
profile.

## Health, evidence, and failure behavior

Support-safe health may expose profile/workspace/RuntimeState revisions, lifecycle state, fencing
epoch, adapter readiness, last successful checkpoint/commit timestamps, and correlation references.
It must not expose tokens, signed profile bodies, member content, raw provider payloads, WebDAV
paths, Matrix recovery material, or decryptable state.

`READY` and production claims require reproducible evidence for:

- cell deletion and reconstruction on another Kubernetes node without the old filesystem;
- stale-writer rejection after lease/fencing changes and crash injection at every commit boundary;
- exactly-once Matrix wake/dedupe plus official Matrix E2EE/device recovery;
- OAuth audience, user/workload identity, token exchange, revocation, and no-token-relay negatives;
- workspace conflicts, encrypted checkpoint rollback, key rotation, backup/restore, and deletion;
- gVisor isolation, resource/network limits, SBOM/signature, accessibility, and support bundles.

Missing entitlement, profile verification, RuntimeState, workspace, secrets, Matrix, MCP, or fencing
evidence fails closed. A degraded dependency may leave support-safe diagnostics, but must not process
member events or domain side effects.

## Fork operations

Run before every handoff and upstream upgrade:

```bash
pnpm check:weaver-fork
pnpm test:weaver-distribution
git diff --check
```

The fork check is offline and deterministic for a declared `WEAVER_FORK_CHECK_DATE`; CI should set
that value to its UTC build date. It verifies the annotated upstream pin, reviewed security release,
review freshness, changed paths, plugin/core approvals, and line budgets. Updating the date without
reviewing upstream releases and advisories is not valid evidence.
