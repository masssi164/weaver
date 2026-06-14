import { describe, expect, it } from "vitest";
import pluginManifest from "../openclaw.plugin.json" with { type: "json" };
import packageJson from "../package.json" with { type: "json" };
import { resolveWeaveChatAccount } from "./accounts.js";
import { buildWeaveChatSendBoundary } from "./client.js";
import { weaveChatPluginConfigSchema } from "./config-schema.js";
import { WEAVE_CHAT_CHANNEL_ID } from "./constants.js";
import {
  buildWeaveChatApprovalHintEvent,
  buildWeaveChatFailureEvent,
  buildWeaveChatSessionKey,
  createInboundDeliveryGate,
  normalizeWeaveChatInboundMessage,
} from "./weave-chat-contract.js";

const inboundFixture = {
  kind: "message",
  eventId: "evt_123",
  messageId: "msg_123",
  idempotencyKey: "idem_123",
  deliveryCursor: "cursor_123",
  sentAt: "2026-06-14T14:00:00.000Z",
  runtimeProfileHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  runtimeProfileVersion: 3,
  scope: {
    tenantId: "tenant_alpha",
    orgId: "org_1",
    userId: "user_1",
    conversationId: "conv_1",
    spaceId: "space_1",
    channelId: "channel_1",
    threadId: "thread_1",
  },
  text: "hello from weave chat",
} as const;

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

  it("rejects provider-native member runtime config through the runtime schema", () => {
    const parsed = weaveChatPluginConfigSchema.runtime.safeParse({
      apiUrl: "https://weave.example.org",
      runtimeProfileHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      runtimeProfileVersion: 3,
      userRuntimeId: "runtime-user-1",
      runtimeTokenRef: { source: "runtime-token", id: "chat-token" },
      providerRef: "matrix-prod",
      homeserver: "https://matrix.example.org",
      slackBotToken: "xoxb-forbidden",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issueText = JSON.stringify(parsed.issues);
      expect(issueText).toContain("providerRef");
      expect(issueText).toContain("homeserver");
      expect(issueText).toContain("slackBotToken");
    }
  });

  it("resolves only signed Weave runtime fields and CredentialRefs", () => {
    const account = resolveWeaveChatAccount({
      cfg: {
        channels: {
          "weave-chat": {
            apiUrl: "https://weave.example.org",
            runtimeProfileHash:
              "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            runtimeProfileVersion: 7,
            userRuntimeId: "usr_runtime_123",
            runtimeTokenRef: { source: "runtime-token", id: "chat-token" },
            webhookPath: "/runtime/weave-chat/webhook",
            eventStreamPath: "/runtime/weave-chat/events",
            defaultTo: "weave-room-1",
          },
        },
      },
    });

    expect(account).toMatchObject({
      accountId: "default",
      configured: true,
      apiUrl: "https://weave.example.org",
      runtimeProfileVersion: 7,
      userRuntimeId: "usr_runtime_123",
      runtimeTokenRef: { source: "runtime-token", id: "chat-token" },
      webhookPath: "/runtime/weave-chat/webhook",
      eventStreamPath: "/runtime/weave-chat/events",
      defaultTo: "weave-room-1",
    });
    expect(JSON.stringify(account)).not.toMatch(/providerRef|homeserver|slack|matrix|telegram/i);
  });

  it("normalizes inbound Weave Chat events into a tenant-scoped session route without raw provider ids", () => {
    const normalized = normalizeWeaveChatInboundMessage({ event: inboundFixture });

    expect(normalized).toMatchObject({
      channelId: "weave-chat",
      accountId: "default",
      sessionKey: "weave-chat:tenant:tenant_alpha:conversation:conv_1:thread:thread_1",
      target: "tenant_alpha/conv_1",
      threadId: "thread_1",
      messageId: "msg_123",
      userId: "user_1",
      text: "hello from weave chat",
    });
    expect(normalized.observability).toMatchObject({
      type: "channel_message_received",
      tenantId: "tenant_alpha",
      conversationId: "conv_1",
      threadId: "thread_1",
      messageId: "msg_123",
    });
    expect(JSON.stringify(normalized)).not.toMatch(/matrix|slack|telegram|providerRef|secret/i);
  });

  it("isolates tenants in session mapping even when conversation ids collide", () => {
    const sameConversationOtherTenant = {
      ...inboundFixture,
      scope: { ...inboundFixture.scope, tenantId: "tenant_beta" },
    };

    expect(buildWeaveChatSessionKey(inboundFixture)).not.toBe(
      buildWeaveChatSessionKey(sameConversationOtherTenant),
    );
  });

  it("suppresses duplicate inbound deliveries so one tenant+message+idempotency key yields one visible effect", () => {
    const gate = createInboundDeliveryGate();

    const first = gate.markIfDuplicate(inboundFixture);
    const second = gate.markIfDuplicate(inboundFixture);
    const third = gate.markIfDuplicate({
      ...inboundFixture,
      scope: { ...inboundFixture.scope, tenantId: "tenant_beta" },
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.observability.type).toBe("channel_duplicate_ignored");
    expect(third.duplicate).toBe(false);
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
        target: "tenant_alpha/conv_1",
        text: "hello",
        runtimeProfileHash: account.runtimeProfileHash,
        runtimeProfileVersion: account.runtimeProfileVersion,
        userRuntimeId: account.userRuntimeId,
        idempotencyKey: "send-123",
        deliveryStatus: "pending",
      },
    });

    expect(boundary.url).toBe("https://weave.example.org/runtime/chat/messages");
    expect(boundary.headers).toMatchObject({
      "x-weave-runtime-profile-hash": account.runtimeProfileHash,
      "x-weave-runtime-profile-version": "3",
      "x-weave-user-runtime-id": "runtime-user-1",
      "x-weave-runtime-token-ref": "runtime-token:chat-token",
      "x-weave-idempotency-key": "send-123",
    });
    expect(boundary.body).toMatchObject({
      target: "tenant_alpha/conv_1",
      text: "hello",
      idempotencyKey: "send-123",
      deliveryStatus: "pending",
    });
    expect(JSON.stringify(boundary)).not.toMatch(
      /matrix|slack|msteams|imessage|chat\.send_message/i,
    );
  });

  it("renders approval hints as accessible channel UX events", () => {
    const approval = buildWeaveChatApprovalHintEvent({
      sessionKey: "weave-chat:tenant:tenant_alpha:conversation:conv_1",
      approvalId: "approval_123",
      correlationId: "corr_123",
      turnId: "turn_123",
      text: "Approve running this tool?",
      options: [
        { id: "approve", label: "Approve" },
        { id: "deny", label: "Deny" },
      ],
    });

    expect(approval).toMatchObject({
      kind: "approval_hint",
      status: "pending",
      approvalId: "approval_123",
      correlationId: "corr_123",
      turnId: "turn_123",
      accessibility: {
        role: "group",
        label: "Approval required",
        description: "Approve running this tool?",
      },
    });
    expect(approval.options).toEqual([
      { id: "approve", label: "Approve", accessibilityLabel: "Approve" },
      { id: "deny", label: "Deny", accessibilityLabel: "Deny" },
    ]);
  });

  it("maps failure UX states to user-visible, audit-safe channel events", () => {
    const codes = [
      "weaver_offline",
      "model_timeout",
      "api_failure",
      "profile_revoked",
      "approval_denied",
      "approval_expired",
    ] as const;

    for (const code of codes) {
      const event = buildWeaveChatFailureEvent({
        sessionKey: "weave-chat:tenant:tenant_alpha:conversation:conv_1",
        correlationId: `corr-${code}`,
        turnId: `turn-${code}`,
        code,
      });

      expect(event).toMatchObject({
        kind: "status",
        status: "failed",
        code,
      });
      expect(event.text.length).toBeGreaterThan(10);
      expect(JSON.stringify(event)).not.toMatch(/token|secret|providerRef/i);
    }
  });

  it("stays channel-only and does not introduce MCP server registration transport", async () => {
    const pluginModule = await import("./channel.js");
    const pluginText =
      JSON.stringify(pluginManifest) + JSON.stringify(pluginModule.weaveChatPlugin);

    expect(pluginText).toContain('"id":"weave-chat"');
    expect(pluginText).not.toContain("chat.send_message");
    expect(pluginText).not.toContain("registerTool");
    expect(pluginText).not.toContain("mcpServer");
  });
});
