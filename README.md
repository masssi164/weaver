# Weaver

**A personal agent for your workspace. On your terms.**

Weaver brings the OpenClaw agent runtime into [Weave](https://github.com/masssi164/weave)'s provider-neutral collaboration model. It is a thin, upstream-first distribution — not another agent engine and not a standalone replacement for Weave.

**Weave provides the collaboration foundation. Weaver is the optional assistant that works within its boundaries.**

[How it fits](#how-weave-and-weaver-fit-together) · [Development](#develop-and-verify) · [Operations](docs/weaver/operations.md) · [Upstream provenance](UPSTREAM.md)

> **In development:** the RuntimeProfile startup guard and distribution checks are executable. Full governed deployment and live Weave integration are still being qualified. A successful build is not a production-readiness claim.

## How Weave and Weaver fit together

Weave owns the collaboration context and domain permissions. Weaver supplies the narrow startup and distribution layer for an OpenClaw personal agent assigned to an entitled member.

The design is **the member's rights, within organization-approved capabilities**. Choosing an assistant must not mean handing it an unrestricted copy of every provider credential or creating a second permission system.

- **Weave:** Files, Calendar, Chat, provider boundaries, and authorization of domain operations.
- **Agent Runtime Control:** signed RuntimeProfiles, cell lifecycle, leases, fencing, and revocation.
- **OpenClaw:** the agent loop, Matrix plugin, sessions, skills, memory, MCP client, and native approvals.
- **Weaver:** connect those responsibilities without duplicating them.

Keycloak remains the identity and entitlement authority. A signed RuntimeProfile or an OpenClaw approval is not, by itself, permission for a domain side effect.

## What is available now

The distribution is based on signed **OpenClaw v2026.9.8**. [UPSTREAM.md](UPSTREAM.md) records the pinned commit, provenance, and upgrade procedure; upstream runtime code, dependency manifests, lockfiles, and licence notices remain unchanged.

The managed startup guard verifies the projector's response against the exact profile bytes and cell binding. It rejects literal credentials, additional channels, unsafe paths, and missing verification, then launches the stock OpenClaw gateway with explicit configuration and state paths.

**Managed MCP is still disabled.** The Weave-side MCP contract is for Files and Calendar; conversation uses the Weave Matrix facade. The complete workload-authorization integration must be proven before MCP is enabled in Weaver cells. There is no shared-token, static-header, or human-OAuth fallback.

Cross-node reconstruction, isolation, Matrix E2EE recovery, workload authorization, backup/restore, accessibility, and chaos evidence remain separate acceptance requirements. See [architecture](docs/weaver/architecture.md) and the [upstream review scope](docs/weaver/upstream-review.md).

## Develop and verify

Use the Node engine and pinned pnpm version from [package.json](package.json). Start with the distribution checks rather than treating this repository as a ready-to-deploy service:

```bash
git clone https://github.com/masssi164/weaver.git
cd weaver
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
node scripts/weaver/check-fork-boundary.mjs
pnpm exec vitest run --config scripts/weaver/vitest.config.mjs
pnpm audit --prod --audit-level high
pnpm build
git diff --check
```

The focused Vitest configuration runs the complete Weaver seam suite. It neither replaces upstream release validation nor disables upstream tests. The [distribution workflow](.github/workflows/weaver-distribution.yml) also checks signed-tag provenance, untouched upstream inputs, fork limits, and review freshness.

The former downstream package-script aliases are intentionally absent. The direct commands above keep OpenClaw's package metadata and lockfiles byte-identical to upstream.

## Managed startup

A cell is provisioned by the surrounding Weave control plane, not by interactive OpenClaw onboarding. The following is the launcher interface, not a standalone installation recipe; it requires a trusted projector, a signed profile, and prepared ephemeral directories.

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

The trusted projector verifies the signed profile. The guard checks its result before starting the gateway. The durability design places persistent data outside the disposable cell: Control Store, immutable WebDAV Workspace Store, encrypted Runtime State Store, and Secret Broker. Local container files are not canonical state.

Read [Operations](docs/weaver/operations.md) before deployment work and [OpenClaw documentation](https://docs.openclaw.ai) for upstream behavior.

## Contribute in the right place

Runtime improvements belong in [OpenClaw](https://github.com/openclaw/openclaw) where possible. Weaver-specific startup, distribution, integration tests, and documentation belong here. Start with [the issues](https://github.com/masssi164/weaver/issues) and keep the fork small.

Weave and Weaver are developed together, but Weave does not require an agent to be useful. See [Weave](https://github.com/masssi164/weave) for the collaboration platform and its roadmap.

## License

Original Weaver-owned material is licensed under **EUPL-1.2-or-later**. The root [LICENSE](LICENSE) retains OpenClaw's MIT terms, and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) preserves incorporated third-party notices. Earlier licence grants are not revoked.

Read [Weaver licensing](docs/weaver/licensing.md) for the exact boundary and full EUPL text, and [contribution guidance](docs/weaver/contributing.md) for DCO sign-off. Contributors retain copyright. AI-assisted development and communication are welcome with disclosure and human responsibility.
