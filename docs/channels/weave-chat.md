---
summary: "Weaver member-mode chat channel backed by the Weave Chat runtime API"
title: "Weave Chat channel"
read_when:
  - You are working on the Weaver fork channel seam
  - You need to verify providerRefs stay backend-only
  - You are reviewing RuntimeProfile-generated chat config
---

Weaver registers one member-mode chat channel: `weave-chat`.

The channel is generated from a signed Weave `WeaverRuntimeProfile`. It talks to the Weave Chat runtime API with `runtimeProfileHash`, profile version, user runtime id, and a short-lived runtime-token `CredentialRef`. It does not configure Matrix, Teams, Slack, iMessage, or future provider transports directly in the member runtime.

Provider routing stays in Weave. Provider identifiers may appear as backend-only `providerRefs` in audit metadata, but they are not projected into `channels.weave-chat` and are never rendered as provider-native channel config. Raw provider secrets, tokens, cookies, provider-native URLs, setup wizards, and dashboard controls are not part of the generated member channel config.

## Generated config shape

```json
{
  "channels": {
    "weave-chat": {
      "apiUrl": "https://weave.example.org",
      "runtimeProfileHash": "sha256:...",
      "runtimeProfileVersion": 1,
      "userRuntimeId": "usr_runtime_123",
      "runtimeTokenRef": { "source": "runtime-token", "id": "weave-chat" },
      "webhookPath": "/runtime/weave-chat/webhook",
      "eventStreamPath": "/runtime/weave-chat/events"
    }
  }
}
```

Outbound messages use the Weave Chat runtime API boundary (`/runtime/chat/messages`). Inbound delivery is reserved for the Weave webhook/event-stream boundary. Both boundaries carry profile hash/version metadata so audit can tie channel decisions back to the signed profile.

## LM Studio round-trip evidence harness

Sprint 14 adds a CI-safe harness for the local LM Studio `weave-chat` proof. The default command is offline and deterministic, so it can run without a local model server while still proving the stable channel path, model-response handoff, outbound `weave-chat` reply, and RuntimeProfile tool policy (`message.send` allowed, `exec` denied):

```sh
node --import tsx scripts/weaver/weave-chat-roundtrip.ts
```

The support-safe JSON output records `mode: "offline"`, `lmStudio.liveCall: "skipped_offline"`, the container-visible default base URL `https://lmstudio.home.internal/v1`, and the model alias `lmstudio/qwen/qwen3.5-9b` without copying raw OpenClaw config or credentials.

Run live evidence only from the container/runtime boundary where LM Studio is reachable through the internal name, not host-local `localhost`:

```sh
WEAVER_WEAVE_CHAT_ROUNDTRIP_LIVE=1 \
WEAVER_LMSTUDIO_BASE_URL=https://lmstudio.home.internal/v1 \
WEAVER_LMSTUDIO_MODEL=lmstudio/qwen/qwen3.5-9b \
node --import tsx scripts/weaver/weave-chat-roundtrip.ts
```

A successful live run records `mode: "live"`, `lmStudio.liveCall: "completed"`, the OpenAI-compatible request model `qwen/qwen3.5-9b`, an inbound `weave-chat` fixture message, and an outbound `weave-chat` reply. The harness rejects `localhost`/loopback LM Studio URLs for live evidence so host-only model access cannot be mistaken for container-visible proof. If LM Studio is not running or the container DNS name is unavailable, keep the offline evidence and report the live prerequisite as blocked rather than checking in secrets or host-specific config.
