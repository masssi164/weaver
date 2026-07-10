---
summary: "Retired Weaver-specific chat plugin and its Matrix replacement"
title: "Weave Chat plugin migration"
read_when:
  - You are removing an old channels.weave-chat configuration
  - You need the supported Weaver Matrix configuration
---

The custom `weave-chat` plugin is retired. Weaver uses OpenClaw's standard
`matrix` plugin against the Matrix Client-Server API exposed by the Weave
northbound gateway.

There is no compatibility alias. Remove `channels.weave-chat` and regenerate the
runtime configuration from a current signed Weave `WeaverRuntimeProfile`.

The generated profile contains `channels.matrix` with the Weave facade URL,
Matrix user and room identifiers, and an OpenClaw `SecretRef` for the access
token. It enables Matrix-native exec and plugin approval delivery. Encryption is
disabled on this northbound protocol facade; southbound Matrix, Teams, Slack, or
other provider selection remains inside Weave.

See [Matrix](/channels/matrix), especially the native approval section, and
[Weaver RuntimeProfile loader](/weaver-runtime-profile) for the current contract.
