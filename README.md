# Weaver

Weaver is the Weave-governed distribution of
[OpenClaw](https://github.com/openclaw/openclaw). It runs one disposable personal agent cell for
each currently entitled Weave member while preserving OpenClaw's upstream agent loop, sessions,
official Matrix plugin, MCP client, skills, memory, and native approval lifecycle.

This branch is based directly on the annotated OpenClaw release `v2026.7.1` at commit
`2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4`. The Weaver layer is intentionally limited to
distribution documentation, a fail-closed RuntimeProfile launch guard, and a deterministic fork
budget. See [UPSTREAM.md](UPSTREAM.md) for provenance and upgrade rules.

> **Status:** target architecture with an executable bootstrap guard. Cross-node reconstruction,
> production Kubernetes/gVisor isolation, live Matrix E2EE, workload MCP authorization, backup and
> restore, accessibility, and chaos evidence are not yet complete. This repository does not claim
> production readiness or a proven zero-durable-byte cell.

## Product boundary

- **Keycloak** is Weave's identity backbone, federation broker, and entitlement authority.
- **Agent Runtime Control** issues signed, short-lived RuntimeProfiles and owns cell lifecycle,
  leases, fencing, revocation, and support-safe correlation.
- **OpenClaw** owns the runtime: agent execution, official Matrix integration, MCP consumption,
  sessions, memory/skills, and approvals.
- **Weave domains** reauthorize every MCP side effect using the server-resolved member binding and
  the authenticated per-cell workload identity.
  Neither a RuntimeProfile nor an OpenClaw approval grants a domain permission.

Weaver does not carry a custom agent loop, Matrix channel, approval engine, MCP protocol, or
memory/skill engine. External identity providers connect upstream of Keycloak; they do not replace
the Weave identity boundary.

## Runtime startup

A managed Weaver cell must start through the RuntimeProfile guard, never through interactive
OpenClaw onboarding or a hand-written member configuration:

```bash
pnpm weaver:launch -- \
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

The orchestrator-selected projector verifies the signed RuntimeProfile and emits a stock OpenClaw
configuration. The guard independently binds that result to the exact signed-envelope bytes and
the orchestrator-selected cell/client, rejects raw credentials, non-Matrix channels,
non-ephemeral paths, v1 projections, and failed or missing verification, then launches upstream
OpenClaw with fixed config and state paths.

RuntimeProfile v2 requires per-cell Keycloak `client_credentials` at MCP. OpenClaw `v2026.7.1`
supports interactive MCP OAuth but not the pinned client-credentials extension, so the guard
requires MCP to remain absent and explicitly disabled. It will not silently substitute a human
OAuth flow, static header, or shared service account. See
[Weaver operations](docs/weaver/operations.md) for the temporary projector protocol.

## Architecture

Durability is external to the cell:

- Control Store: desired state, lease/fencing epoch, workspace HEAD, wake dedupe, conflicts, and
  audit correlation;
- Workspace Store: immutable, signed WebDAV workspace revisions;
- Runtime State Store: encrypted, complete OpenClaw state generations;
- Secret Broker: short-lived Matrix, model, storage, and encryption credentials.

Local dogfood uses a Docker cell-orchestrator adapter. The production evidence target is Kubernetes
with gVisor behind the same port. Neither adapter may turn a pod/container volume into canonical
state.

Read [Weaver architecture](docs/weaver/architecture.md) and
[Weaver operations](docs/weaver/operations.md) before changing runtime or deployment behavior.

## Development gates

Use the pinned package manager and supported Node release from `package.json`.

```bash
pnpm build
pnpm check:weaver-fork
pnpm test:weaver-distribution
pnpm format:docs:check
node scripts/check-docs-mdx.mjs docs/weaver README.md UPSTREAM.md
git diff --check
```

`pnpm check:weaver-fork` fails when the upstream tag or commit moves, the security review becomes
stale, the changed-file/line budget is exceeded, an undeclared plugin appears, or a core patch lacks
an owner, upstream issue, bounded line budget, and removal criterion.

## Upstream documentation and license

Weaver inherits the upstream OpenClaw documentation in `docs/`. Use the
[OpenClaw documentation](https://docs.openclaw.ai) for upstream CLI, configuration, Matrix, MCP,
plugin, and runtime behavior. Weaver deployment policy in `docs/weaver/` is narrower and takes
precedence for managed cells.

OpenClaw is MIT-licensed. The upstream copyright and license remain in [LICENSE](LICENSE), and
incorporated third-party notices remain in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
