import { describe, expect, it } from "vitest";
import pluginManifest from "../openclaw.plugin.json" with { type: "json" };
import packageJson from "../package.json" with { type: "json" };
import { resolveWeaveChatAccount } from "./accounts.js";
import { buildWeaveChatSendBoundary } from "./client.js";
import { WEAVE_CHAT_CHANNEL_ID } from "./constants.js";

describe("weave-chat channel seam", () => {
  it("declares the stable channel id in manifest and package metadata", () => {
    expect(WEAVE_CHAT_CHANNEL_ID).toBe("weave-chat");
    expect(pluginManifest.channels).toEqual(["weave-chat"]);
    expect(packageJson.openclaw.channel.id).toBe("weave-chat");
    expect(pluginManifest.configSchema.properties).toHaveProperty("runtimeProfileHash");
    expect(pluginManifest.configSchema.properties).toHaveProperty("runtimeProfileVersion");
    expect(pluginManifest.configSchema.properties).toHaveProperty("userRuntimeId");
    expect(pluginManifest.configSchema.properties).toHaveProperty("runtimeTokenRef");
  });

  it("keeps providerRefs and provider-native channel config out of member runtime config", () => {
    const manifestText = JSON.stringify(pluginManifest);
    expect(manifestText).not.toContain("providerRef");
    expect(manifestText).not.toContain("homeserver");
    expect(manifestText).not.toContain("slack");
    expect(manifestText).not.toContain("imessage");
    expect(manifestText).not.toContain("msteams");
  });

  it("builds outbound calls only against the Weave Chat runtime API boundary", () => {
    const account = resolveWeaveChatAccount({
      cfg: {
        channels: {
          "weave-chat": {
            apiUrl: "https://weave.example.org/base",
            runtimeProfileHash:
              "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            runtimeProfileVersion: 3,
            userRuntimeId: "runtime-user-1",
            runtimeTokenRef: { source: "runtime-token", id: "chat-token" },
          },
        },
      },
    });

    const boundary = buildWeaveChatSendBoundary({
      account,
      request: {
        target: "provider-backed-room",
        text: "hello",
        runtimeProfileHash: account.runtimeProfileHash,
        runtimeProfileVersion: account.runtimeProfileVersion,
        userRuntimeId: account.userRuntimeId,
      },
    });

    expect(boundary.url).toBe("https://weave.example.org/runtime/chat/messages");
    expect(boundary.headers).toMatchObject({
      "x-weave-runtime-profile-hash": account.runtimeProfileHash,
      "x-weave-runtime-profile-version": "3",
      "x-weave-user-runtime-id": "runtime-user-1",
      "x-weave-runtime-token-ref": "runtime-token:chat-token",
    });
    expect(JSON.stringify(boundary)).not.toMatch(/matrix|slack|msteams|imessage/i);
  });
});
