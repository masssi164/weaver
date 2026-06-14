import {
  createPluginRuntimeMock,
  createStartAccountContext,
} from "openclaw/plugin-sdk/channel-test-helpers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { weaveChatPlugin } from "../channel-plugin-api.js";
import { resolveWeaveChatAccount } from "./accounts.js";
import { WEAVE_CHAT_CHANNEL_ID, WEAVE_CHAT_INBOUND_RUNTIME_CAPABILITY } from "./constants.js";
import { getWeaveChatInboundRuntimeContext } from "./inbound.js";
import type { CoreConfig } from "./types.js";
import type { WeaveChatInboundEvent } from "./weave-chat-contract.js";

const hoisted = vi.hoisted(() => ({
  sendWeaveChatMessage: vi.fn(async () => ({ messageId: "reply-1" })),
}));

vi.mock("./client.js", async () => {
  const actual = await vi.importActual<typeof import("./client.js")>("./client.js");
  return {
    ...actual,
    sendWeaveChatMessage: hoisted.sendWeaveChatMessage,
  };
});

const cfg: CoreConfig = {
  channels: {
    "weave-chat": {
      apiUrl: "https://weave.example.org",
      runtimeProfileHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      runtimeProfileVersion: 3,
      userRuntimeId: "runtime-user-1",
      runtimeTokenRef: { source: "runtime-token", id: "chat-token" },
    },
  },
};

function createEvent(overrides: Partial<WeaveChatInboundEvent> = {}): WeaveChatInboundEvent {
  return {
    kind: "message",
    eventId: "evt-1",
    messageId: "msg-1",
    idempotencyKey: "idem-1",
    deliveryCursor: "cursor-1",
    sentAt: "2026-06-14T14:00:00.000Z",
    runtimeProfileHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    runtimeProfileVersion: 3,
    scope: {
      tenantId: "tenant-a",
      userId: "user-1",
      conversationId: "conv-1",
      threadId: "thread-1",
      ...(overrides.scope ?? {}),
    },
    text: "hello",
    ...overrides,
  };
}

function installRuntimeContextStore(runtime: ReturnType<typeof createPluginRuntimeMock>) {
  const store = new Map<string, unknown>();
  vi.mocked(runtime.channel.runtimeContexts.register).mockImplementation(
    ({ channelId, accountId, capability, context, abortSignal }) => {
      const key = `${channelId}:${accountId ?? ""}:${capability}`;
      store.set(key, context);
      const dispose = () => {
        store.delete(key);
      };
      abortSignal?.addEventListener("abort", dispose, { once: true });
      return { dispose };
    },
  );
  vi.mocked(runtime.channel.runtimeContexts.get).mockImplementation(
    ({ channelId, accountId, capability }) =>
      store.get(`${channelId}:${accountId ?? ""}:${capability}`),
  );
}

function requireStartAccount() {
  const startAccount = weaveChatPlugin.gateway?.startAccount;
  if (!startAccount) throw new Error("Expected weave-chat gateway startAccount");
  return startAccount;
}

async function startRegisteredRuntime() {
  const runtime = createPluginRuntimeMock();
  installRuntimeContextStore(runtime);
  vi.mocked(runtime.channel.routing.resolveAgentRoute).mockReturnValue({
    agentId: "agent-main",
    sessionKey: "route-session",
    accountId: "default",
  });
  const account = resolveWeaveChatAccount({ cfg, accountId: "default" });
  const abort = new AbortController();
  const task = requireStartAccount()(
    Object.assign(createStartAccountContext({ account, cfg, abortSignal: abort.signal }), {
      channelRuntime: runtime.channel,
    }),
  );
  const inbound = getWeaveChatInboundRuntimeContext({
    runtime: runtime.channel,
    accountId: "default",
  });
  if (!inbound) {
    throw new Error("Expected registered weave-chat inbound runtime context");
  }
  return { runtime, inbound, abort, task };
}

describe("weave-chat inbound runtime seam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("registers an inbound runtime context, runs one turn, and returns the reply over Weave Chat", async () => {
    const { runtime, inbound, abort, task } = await startRegisteredRuntime();
    vi.mocked(
      runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher,
    ).mockImplementationOnce(async ({ dispatcherOptions }) => {
      await dispatcherOptions.deliver({ text: "hello back" }, { kind: "final" });
      return { queuedFinal: true, counts: { tool: 0, block: 0, final: 1 } };
    });

    await inbound.handleEvent(createEvent());

    expect(runtime.channel.inbound.dispatchReply).toHaveBeenCalledTimes(1);
    const call = vi.mocked(runtime.channel.inbound.dispatchReply).mock.calls[0]?.[0];
    expect(call?.routeSessionKey).toBe(
      "weave-chat:tenant:tenant-a:conversation:conv-1:thread:thread-1",
    );
    expect(hoisted.sendWeaveChatMessage).toHaveBeenCalledTimes(1);
    expect(hoisted.sendWeaveChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          target: "tenant-a/conv-1",
          text: "hello back",
          threadId: "thread-1",
          replyToId: "msg-1",
        }),
      }),
    );

    abort.abort();
    await task;
  });

  it("drops duplicate inbound events through the registered runtime seam", async () => {
    const { runtime, inbound, abort, task } = await startRegisteredRuntime();
    vi.mocked(runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher).mockImplementation(
      async ({ dispatcherOptions }) => {
        await dispatcherOptions.deliver({ text: "hello back" }, { kind: "final" });
        return { queuedFinal: true, counts: { tool: 0, block: 0, final: 1 } };
      },
    );

    await inbound.handleEvent(createEvent());
    await inbound.handleEvent(createEvent());

    expect(runtime.channel.inbound.dispatchReply).toHaveBeenCalledTimes(1);
    expect(hoisted.sendWeaveChatMessage).toHaveBeenCalledTimes(1);

    abort.abort();
    await task;
  });

  it("keeps same conversation ids isolated across tenants through the runtime seam", async () => {
    const { runtime, inbound, abort, task } = await startRegisteredRuntime();

    await inbound.handleEvent(
      createEvent({
        scope: {
          tenantId: "tenant-a",
          userId: "user-1",
          conversationId: "shared",
          threadId: "thread-1",
        },
      }),
    );
    await inbound.handleEvent(
      createEvent({
        eventId: "evt-2",
        messageId: "msg-2",
        idempotencyKey: "idem-2",
        scope: {
          tenantId: "tenant-b",
          userId: "user-1",
          conversationId: "shared",
          threadId: "thread-1",
        },
      }),
    );

    const calls = vi
      .mocked(runtime.channel.inbound.dispatchReply)
      .mock.calls.map(([arg]) => arg.routeSessionKey);
    expect(calls).toEqual([
      "weave-chat:tenant:tenant-a:conversation:shared:thread:thread-1",
      "weave-chat:tenant:tenant-b:conversation:shared:thread:thread-1",
    ]);

    abort.abort();
    await task;
  });

  it("fails closed on malformed required inbound fields", async () => {
    const { runtime, inbound, abort, task } = await startRegisteredRuntime();

    await expect(
      inbound.handleEvent(
        createEvent({
          text: "",
          scope: { tenantId: "", userId: "", conversationId: "" } as never,
        }),
      ),
    ).rejects.toThrow();
    expect(runtime.channel.inbound.dispatchReply).not.toHaveBeenCalled();

    abort.abort();
    await task;
  });

  it.each([
    ["model timeout", "model_timeout", "The model took too long to respond. Please try again."],
    ["runtime unavailable", "weaver_offline", "Weaver is offline right now. Please retry shortly."],
    [
      "profile invalid for runtime",
      "profile_revoked",
      "This runtime profile is no longer valid. Reconnect Weaver to continue.",
    ],
  ] as const)(
    "sends a support-safe failure event when inbound dispatch fails: %s",
    async (message, code, text) => {
      const { runtime, inbound, abort, task } = await startRegisteredRuntime();
      vi.mocked(runtime.channel.inbound.dispatchReply).mockRejectedValueOnce(new Error(message));

      await expect(inbound.handleEvent(createEvent())).rejects.toThrow(message);

      expect(hoisted.sendWeaveChatMessage).toHaveBeenCalledTimes(1);
      expect(hoisted.sendWeaveChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({
            target: "tenant-a/conv-1",
            text,
            idempotencyKey: expect.stringContaining(`:failure:${code}`),
            deliveryStatus: "failed",
          }),
        }),
      );

      abort.abort();
      await task;
    },
  );

  it("exposes approval prompt rendering through the channel approval hook", () => {
    const payload = weaveChatPlugin.approvalCapability?.render?.exec?.buildPendingPayload?.({
      cfg: cfg as never,
      target: { channel: "weave-chat", to: "tenant-a/conv-1" },
      nowMs: 1_789_000_000_000,
      request: { id: "approval-1", command: "open calendar" } as never,
    });

    expect(payload?.text).toContain("Approval required");
    expect(payload?.text).toContain("Action: exec");
    expect(payload?.text).toContain("Options: approve, deny, or open details.");
    expect(payload?.isStatusNotice).toBe(true);
    expect(payload?.channelData?.weaveChat).toMatchObject({
      eventType: "approval.prompt",
      approval: {
        approvalId: "approval-1",
        accessibility: {
          label: "Approval required",
        },
        options: [
          { id: "approve", label: "Approve", accessibilityLabel: "Approve" },
          { id: "deny", label: "Deny", accessibilityLabel: "Deny" },
          {
            id: "open",
            label: "Open details",
            accessibilityLabel: "Open details",
          },
        ],
      },
    });
  });

  it("does not register MCP contexts or call chat.send_message from the inbound seam", async () => {
    const { runtime, inbound, abort, task } = await startRegisteredRuntime();

    await inbound.handleEvent(createEvent());

    expect(hoisted.sendWeaveChatMessage).not.toHaveBeenCalled();
    expect(
      runtime.channel.runtimeContexts.get({
        channelId: WEAVE_CHAT_CHANNEL_ID,
        accountId: "default",
        capability: "approval.native",
      }),
    ).toBeUndefined();
    expect(
      runtime.channel.runtimeContexts.get({
        channelId: WEAVE_CHAT_CHANNEL_ID,
        accountId: "default",
        capability: WEAVE_CHAT_INBOUND_RUNTIME_CAPABILITY,
      }),
    ).toBeTruthy();

    abort.abort();
    await task;
  });
});
