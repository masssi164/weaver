# Weave integration boundary

This repository is the Weaver runtime repository. It is an OpenClaw-derived AI harness/runtime that consumes Weave policy; it is not the Weave product suite and it is not the source of truth for Weave domains, providers, approvals, or audit semantics.

## Weaver owns

- RuntimeProfile loading and validation: signature, hash, profile version, expiry, revocation, rollback, and reload/restart decisions.
- Rendering generated OpenClaw runtime config from the signed Weave `WeaverRuntimeProfile`.
- Member-mode lockdown: raw OpenClaw setup, dashboard/config editing, plugin/channel/MCP/secret/tool allowlist editing, and unsafe local overrides are denied unless the signed profile grants a narrow operator support path.
- Projection of OpenClaw's stock `matrix` plugin against the Weave Matrix Client-Server facade.
- Runtime-side enforcement that tool, MCP, model, channel, reload, revocation, and rollback decisions are audited with support-safe refs.
- Runtime-side application of profile-scoped user customization and tool-use approval constraints; policy meaning and approval semantics still come from Weave.

## Weave owns

- Product semantics: canonical domains, member UX vocabulary, provider-neutral collaboration meaning, and admin/control-room posture.
- Provider/adapter selection, posture, caveats, migration/replacement paths, and readiness evidence.
- MCP/domain-tool action semantics, risk, ApprovalReceipt policy, audit/evidence payload boundaries, and support-safe tool payload rules.
- CredentialRef/SecretRef brokering and signed RuntimeProfile generation.
- The Weave MCP/domain-tool server that Weaver calls, starting with canonical-domain tools such as calendar and files.
- Product/API target for the Weave chat channel.

## Matrix northbound placement

Weaver does not own a Weave-specific chat plugin. It consumes OpenClaw's existing Matrix plugin. Weave owns the northbound Matrix-compatible protocol facade and keeps southbound provider routing behind its canonical Chat domain.

Normal member-mode `channels.matrix` config may contain only the Weave facade homeserver, facade Matrix identifiers, an access-token `SecretRef`, network policy, native approval routing, and profile correlation metadata. It must not contain southbound Matrix, Slack, Teams, Telegram, iMessage, Nextcloud Talk, or other provider setup. Those providers remain Weave backend `providerRef` values and may appear only in support-safe audit metadata approved by the signed profile.

## Review rule

Before merging a Weaver change that mentions Weave, ask: “Am I enforcing a generated runtime/profile/channel/tool boundary, or am I inventing Weave product policy?” If it is product policy, move it to `masssi164/weave` and consume it here only through signed RuntimeProfile or MCP/domain-tool contracts.
