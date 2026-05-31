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

Provider routing stays in Weave. Provider identifiers may appear as backend-only `providerRefs` in audit metadata, but they are not projected into `channels.weave-chat` and are never rendered as provider-native channel config.

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
