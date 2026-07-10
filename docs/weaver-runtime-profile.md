---
summary: "Signed RuntimeProfile loader seam for the Weaver fork"
title: "Weaver RuntimeProfile loader"
read_when:
  - You are working on the Weaver RuntimeProfile boundary
  - You need generated config and member-lockdown expectations
  - You are reviewing profile reload, restart, revocation, or rollback hooks
---

Weaver member mode treats local OpenClaw config as generated output. The loader accepts one signed Weave `WeaverRuntimeProfile`, verifies its Ed25519 signature, profile hash, expiry, profile version, and revocation metadata, then projects internal runtime config.

Generated config includes:

- model aliases, default model, and fallbacks;
- `channels.matrix` using OpenClaw's stock Matrix plugin, the Weave Matrix-facade URL, Matrix identifiers, a token `SecretRef`, and native approval routing;
- MCP entries, skill policy, tool allow/deny policy, and sandbox defaults;
- member-mode lockdown metadata with raw OpenClaw config, wizard, dashboard, plugin/channel/MCP/secrets/sandbox/tool-allowlist admin surfaces denied;
- bounded member controls for Weave-approved style, memory, model alias selection, allowed skills, workspace preferences, and allowed personal MCP connections;
- CredentialRef references and audit export policy;
- `memberConfigLocked: true` so normal member mode can treat hand-authored OpenClaw config edits as bypass attempts.

Raw provider secrets, OAuth refresh tokens, cookies, API keys, and southbound provider configuration are rejected by the loader. The Matrix configuration is a northbound protocol projection owned by Weave, not disclosure of a southbound Matrix provider. Teams, Slack, iMessage, Matrix, and future provider adapters remain backend `providerRef` values and are not rendered as alternative member channels.

## Lifecycle hooks

`createRuntimeProfileLifecycleHooks` defines the reload/restart/rollback seam:

- `reload(profile)` verifies and projects a new signed profile;
- `restart({ runtimeProfileHash, profileVersion })` is the supervisor hook for changes that require a process restart;
- `rollback({ fromRuntimeProfileHash, toRuntimeProfileHash, profileVersion })` records the controlled return to the last accepted profile.

The current implementation is a skeleton boundary for Sprint 13. The hooks are intentionally explicit so later gateway wiring can audit every profile reload, restart, revocation, and rollback decision.

## Member tool and MCP policy

`tools.deny` is a hard-deny in member mode; tools.deny is a hard-deny in member mode for the boundary guard and for reviewers reading plain text. A member-supplied config cannot override it. Gateway, cron, `exec`, `write`, and `apply_patch` are default-deny for member runtimes unless the signed RuntimeProfile grants a narrow `tools.allow` exception. `bundle-mcp` is denied unless the signed profile explicitly sets `mcpPolicy.allowBundleMcp: true`.

`permissionMode` projects the five OpenClaw modes: `deny`, `allowlist`, `ask`,
`auto`, and `full`. Approval-required Spring AI MCP tools use MCP form
elicitation and OpenClaw plugin approvals, which the Matrix plugin renders in the
originating Matrix conversation. An `allow-always` decision is stored in the
shared SQLite state database and is bounded by runtime-profile hash, user
runtime, MCP server, tool, and canonical scope. Profile rotation therefore
invalidates the grant. The `full` mode skips trusted Weave MCP prompts and must
also be paired with a matching host-local exec approvals policy; the Weave
client requires an explicit danger confirmation before enabling it.

Policy decisions export support-safe audit metadata only: runtime profile hash/version, user/runtime id, action or tool, domain, optional stable `channelId`, optional RuntimeProfile-approved `modelRef`, optional backend `providerRef`, optional `CredentialRef`, decision, and reason. The export carries credential references, never raw provider secrets, OAuth refresh tokens, cookies, API keys, or provider-bearing URLs.

Operator/admin support remains possible through explicit `operatorSupport` profile metadata, but normal member UX must show the RuntimeProfile denial message instead of exposing raw OpenClaw configuration, setup wizards, or unsafe dashboard controls.
