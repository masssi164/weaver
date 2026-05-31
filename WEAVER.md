# Weaver RuntimeProfile bootstrap map

Status: Sprint 13 bootstrap note for `masssi164/weaver#1`.

## Product boundary

Weaver is the OpenClaw-derived per-user runtime. Weave remains source of truth for domains, provider selection, credentials, policy, and audit. The fork must consume a signed Weave `WeaverRuntimeProfile` and render internal OpenClaw configuration as generated runtime output, not as member-editable product state.

Normal member mode must not expose raw OpenClaw dashboard, setup wizard, config editing, channel token management, MCP allowlist editing, or secret configuration as a bypass around Weave policy.

## Minimal fork seams

1. **RuntimeProfile loader**
   - Fetch or receive one signed RuntimeProfile from Weave.
   - Verify signature, profile version, expiry, revocation status, and `runtimeProfileHash` before rendering config.
   - Render internal `openclaw.json`, model aliases/default/fallbacks, channel/plugin config, MCP entries, tool filters, sandbox defaults, and audit metadata from the profile only.
   - Treat local config as read-only generated output in member mode.

2. **Stable `weave-chat` channel plugin**
   - Register one channel id, `weave-chat`.
   - Talk only to Weave Chat-domain runtime APIs with a short-lived runtime token and `runtimeProfileHash`.
   - Keep Matrix, Teams, Slack, iMessage, Telegram, and future providers as Weave backend `providerRef` values; do not project provider-named channels into normal Weaver runtime config.

3. **Policy hardening defaults**
   - Enforce `tools.deny` as a hard global deny layer.
   - Keep `bundle-mcp`, gateway, cron, exec, write, and patch-style tools disabled unless the RuntimeProfile explicitly grants a constrained capability.
   - Use CredentialRefs and runtime tokens only; no provider secrets, OAuth refresh tokens, cookies, or credential-bearing URLs in config, logs, prompts, or support bundles.

4. **Audit export**
   - Include `runtimeProfileHash`, user, domain, providerRef, credentialRef where applicable, tool/action, and decision for model, channel, tool, MCP, reload/restart, revocation, and rollback decisions.

## Existing OpenClaw surfaces to inspect first

- Channel plugin SDK: `docs/plugins/sdk-channel-plugins.md`.
- Plugin manifest and channel config contracts: `docs/plugins/manifest.md`, `src/channels/**`, `src/plugins/**`.
- Existing channel plugins: `extensions/matrix/**`, `extensions/msteams/**`, `extensions/slack/**`, `extensions/telegram/**`.
- Config write authorization and setup/dashboard paths: `src/channels/plugins/contracts/**`, `ui/**`, `src/config/**`.
- Tool filtering and deny policy: `src/tools/**`, `src/config/**`, `test/vitest/vitest.tools*.config.ts`.

## First implementation order

1. Add RuntimeProfile schema/types plus tests that reject unsigned, expired, revoked, raw-secret-bearing, or provider-channel-projecting profiles.
2. Add a no-network `weave-chat` plugin skeleton and manifest contract tests.
3. Add generated-config/member-lockdown tests for raw config/setup/dashboard writes.
4. Add audit fixture tests for profile hash/provider/tool/credential decision metadata.
