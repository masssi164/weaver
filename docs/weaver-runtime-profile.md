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
- `channels.weave-chat` with Weave API URL, runtime profile hash/version, user runtime id, and runtime-token `CredentialRef`;
- MCP entries, skill policy, tool allow/deny policy, and sandbox defaults;
- CredentialRef references and audit export policy;
- `memberConfigLocked: true` so normal member mode can treat hand-authored OpenClaw config edits as bypass attempts.

Raw provider secrets, OAuth refresh tokens, cookies, API keys, provider-bearing URLs, and provider-native chat channel config are rejected by the loader. Matrix, Teams, Slack, iMessage, and future transports remain Weave backend `providerRef` values; they may be copied into audit metadata but are not rendered into member runtime config.

## Lifecycle hooks

`createRuntimeProfileLifecycleHooks` defines the reload/restart/rollback seam:

- `reload(profile)` verifies and projects a new signed profile;
- `restart({ runtimeProfileHash, profileVersion })` is the supervisor hook for changes that require a process restart;
- `rollback({ fromRuntimeProfileHash, toRuntimeProfileHash, profileVersion })` records the controlled return to the last accepted profile.

The current implementation is a skeleton boundary for Sprint 13. The hooks are intentionally explicit so later gateway wiring can audit every profile reload, restart, revocation, and rollback decision.
