# Weaver

**A personal agent for your workspace. On your terms.**

Weaver is an optional, upstream-first [OpenClaw](https://github.com/openclaw/openclaw) distribution for [Weave](https://github.com/masssi164/weave) organizations. Weave's approved standalone deployment does not require Weaver, Home-core, or an agent control plane.

**Weave provides the collaboration foundation. Weaver is the optional assistant that works within its boundaries.**

[How it fits](#how-weave-and-weaver-fit-together) · [Development](#develop-and-verify) · [Operations](docs/weaver/operations.md) · [Upstream provenance](UPSTREAM.md)

> **In development:** the RuntimeProfile startup guard and distribution checks are executable. Managed MCP, live Weave integration, Matrix recovery, and external cell-state restoration are unverified. A successful build is not a production-readiness claim.

## How Weave and Weaver fit together

Weave owns the collaboration product, its server API, and domain permissions. Weaver supplies an optional OpenClaw runtime distribution. The current release does not require Weaver's broader cell-control design.

The design is **the member's rights, within organization-approved capabilities**. Choosing an assistant must not mean handing it an unrestricted copy of every provider credential or creating a second permission system.

- **Weave server (approved contract):** product APIs, current member and resource authorization, and provider-backed Files and Calendar operations. Server code is the source for separate User and Admin OpenAPI artifacts and generated product HTTP clients.
- **Weave Flutter:** native Rust/Matrix SDK chat, with Weave-owned stable room associations.
- **OpenClaw/Weaver:** the agent loop, official Matrix plugin, sessions, skills, memory, MCP client, and native approvals. Matrix chat does not move behind a proprietary Weave REST API.
- **Weaver layer:** the small, optional startup and distribution boundary around unchanged upstream runtime code.

Keycloak is the self-hosted default identity provider; Weave supports OIDC/OAuth identity boundaries without making Keycloak the permanent product boundary. The Weave API, Matrix, and any future Weaver workload use appropriately separated audiences and sessions. A signed RuntimeProfile or OpenClaw approval is not, by itself, permission for a domain side effect.

## What is available now

The distribution is based on signed **OpenClaw v2026.9.8**. [UPSTREAM.md](UPSTREAM.md) records the pinned commit, provenance, and upgrade procedure; upstream runtime code, dependency manifests, lockfiles, and licence notices remain unchanged.

The managed startup guard verifies the projector's response against the exact profile bytes and cell binding. It rejects literal credentials, additional channels, unsafe paths, and missing verification, then launches the stock OpenClaw gateway with explicit configuration and state paths.

**Managed MCP is still disabled.** The Weave-side Files/Calendar MCP contract is separate from the Matrix conversational channel. The complete workload-authorization integration must be proven before MCP is enabled in Weaver cells. There is no shared-token, static-header, or human-OAuth fallback.

Cross-node reconstruction, isolation, Matrix E2EE recovery, workload authorization, backup/restore, accessibility, and chaos evidence remain unverified for a managed Weaver deployment. Broad cell orchestration, private Runners, workflows, and context graphs are outside the current Weave release. See the [deferred architecture](docs/weaver/architecture.md) and [upstream review scope](docs/weaver/upstream-review.md).

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

The suite exercises OpenClaw's session MCP client against an isolated loopback endpoint for tool discovery and invocation, checks that operator and Matrix requester OAuth state keys remain separate, and rejects requester-only tools in an operator session. This verifies the client seam only. Live Weave API authorization and the managed-cell workload flow still require integrated validation before MCP can be enabled.

For an isolated live Weave MCP proof, provision a disposable server, a dedicated entitled cell
workload, and a Files fixture visible to its bound member. Mint a short-lived MCP-audience access
token for that cell into an owner-only file outside the repository. Set the following proof inputs
and run the separate live suite:

```bash
export WEAVER_MCP_PROOF_URL=https://api.weave.test/mcp
export WEAVER_MCP_PROOF_TOKEN_FILE=/absolute/private/path/cell-mcp-token
export WEAVER_MCP_PROOF_FILE_QUERY='Roadmap'
export WEAVER_MCP_PROOF_EXPECTED_FILE_ID='file:stable-reference'
export WEAVER_MCP_PROOF_EXPECTED_FILE_NAME='Roadmap'
WEAVER_MCP_LIVE_PROOF=1 pnpm exec vitest run \
  --config scripts/weaver/vitest.config.mjs -t 'live Weave MCP'
```

The proof uses OpenClaw's real session MCP client and fails if discovery, invocation, or the
expected stable Files reference fails. It reads the token only in the test process and does not
persist it in OpenClaw config or artifacts. For local HTTPS, trust the disposable stack's CA with
Node's `NODE_EXTRA_CA_CERTS`. This one-shot test does not supply the managed client-credentials
refresh path, current authorization negatives, or product activation evidence.

The former downstream package-script aliases are intentionally absent. The direct commands above keep OpenClaw's package metadata and lockfiles byte-identical to upstream.

## RuntimeProfile guard interface

The optional managed-cell design requires a trusted projector, signed profile, and prepared ephemeral directories. This launcher interface is not a standalone installation recipe or a prerequisite for Weave's current release:

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

The trusted projector verifies the signed profile. The guard checks its result before starting the gateway. The external Control Store, Workspace Store, Runtime State Store, and Secret Broker are a deferred durability design, not deployed capabilities established by this guard.

Read [Operations](docs/weaver/operations.md) before deployment work and [OpenClaw documentation](https://docs.openclaw.ai) for upstream behavior.

## Contribute in the right place

Runtime improvements belong in [OpenClaw](https://github.com/openclaw/openclaw) where possible. Weaver-specific startup, distribution, integration tests, and documentation belong here. Start with [the issues](https://github.com/masssi164/weaver/issues) and keep the fork small.

Weave and Weaver are developed together, but Weave does not require an agent to be useful. See [Weave](https://github.com/masssi164/weave) for the collaboration platform and its roadmap.

## License

Original Weaver-owned material is licensed under **EUPL-1.2-or-later**. The root [LICENSE](LICENSE) retains OpenClaw's MIT terms, and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) preserves incorporated third-party notices. Earlier licence grants are not revoked.

Read [Weaver licensing](docs/weaver/licensing.md) for the exact boundary and full EUPL text, and [contribution guidance](docs/weaver/contributing.md) for DCO sign-off. Contributors retain copyright. AI-assisted development and communication are welcome with disclosure and human responsibility.
