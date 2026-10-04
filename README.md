# Weaver

Weaver is the Weave-governed distribution of [OpenClaw](https://github.com/openclaw/openclaw).
It preserves the upstream agent runtime and supplies the narrow launch and distribution boundary
for a personal agent cell assigned to an entitled Weave member.

The current candidate is reconstructed from signed OpenClaw **v2026.9.8**, commit
`fc23bc864e4553c2d215e479eeec47b67a0bf943`. See [UPSTREAM.md](UPSTREAM.md) for the exact provenance,
upgrade procedure, and unchanged-runtime policy.

> **Status:** target architecture with an executable RuntimeProfile bootstrap guard. A passing
> distribution check proves neither production readiness nor live Weave integration. Cross-node
> reconstruction, Kubernetes/gVisor isolation, Matrix E2EE recovery, workload MCP authorization,
> backup/restore, accessibility, and chaos evidence remain separate acceptance requirements.

## Product boundary

- **Keycloak** owns Weave identity, federation, and entitlement.
- **Agent Runtime Control** owns signed RuntimeProfiles, lifecycle, leases, fencing, and revocation.
- **OpenClaw** owns the agent loop, Matrix plugin, MCP client, sessions, skills, memory, and approvals.
- **Weave domains** independently authorize every side effect against current member and workload rights.

A RuntimeProfile and an OpenClaw approval are not domain permissions. Weaver does not implement a
second agent loop, Matrix channel, approval engine, identity system, or data plane.

## Managed startup

Use the unchanged RuntimeProfile guard instead of interactive onboarding:

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

The trusted projector must verify the signed profile. The guard binds its result to the exact
profile bytes and cell, rejects literal credentials, additional channels, unsafe paths and missing
verification, and launches the stock upstream gateway with explicit config and state paths.

**MCP remains disabled in managed Weaver cells.** Updating OpenClaw does not itself prove the ARC
client-credentials, token exchange and current-domain-authorization contract. No human OAuth,
shared credentials or static-header fallback is enabled by this update.

The four external durability authorities remain the Control Store, immutable WebDAV Workspace
Store, encrypted Runtime State Store and Secret Broker. Local container files are not canonical
state. Read [Architecture](docs/weaver/architecture.md) and [Operations](docs/weaver/operations.md).

## Development and verification

Use the Node engine and pinned pnpm version in the unchanged upstream `package.json`.
The v2026.9.8 update removes the three downstream package-script aliases; invoke their existing
implementations directly instead. This keeps upstream package metadata and lockfiles byte-identical.

```bash
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
node scripts/weaver/check-fork-boundary.mjs
pnpm exec vitest run --config scripts/weaver/vitest.config.mjs
pnpm audit --prod --audit-level high
pnpm build
git diff --check
```

The dedicated test config runs the complete existing Weaver seam suite; it does not disable an
upstream test or replace upstream release validation. The required distribution workflow also
checks signed-tag provenance, unchanged upstream runtime/dependency inputs and review freshness.

## Upstream documentation and licence

Use [OpenClaw documentation](https://docs.openclaw.ai) for upstream behavior. Weaver deployment
requirements are documented separately and are narrower than a general-purpose OpenClaw install.

The root [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) retain OpenClaw's
MIT terms and incorporated third-party notices. Original Weaver-owned material is licensed under
**EUPL-1.2-or-later**, with the exact scope and full licence text in
[Weaver licensing](docs/weaver/licensing.md). Earlier licence grants are not revoked.

Contributions follow the applicable MIT/EUPL boundary and
[Weaver DCO guidance](docs/weaver/contributing.md). AI-assisted work and communication are welcome
with appropriate disclosure and human responsibility.
