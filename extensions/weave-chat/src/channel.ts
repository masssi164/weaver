import {
  buildChannelOutboundSessionRoute,
  createChatChannelPlugin,
} from "openclaw/plugin-sdk/channel-core";
import type { ChannelPlugin, PluginRuntime } from "openclaw/plugin-sdk/channel-core";
import {
  createMessageReceiptFromOutboundResults,
  defineChannelMessageAdapter,
} from "openclaw/plugin-sdk/channel-outbound";
import { getChatChannelMeta } from "openclaw/plugin-sdk/channel-plugin-common";
import {
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from "openclaw/plugin-sdk/status-helpers";
import {
  listWeaveChatAccountIds,
  resolveDefaultWeaveChatAccountId,
  resolveWeaveChatAccount,
} from "./accounts.js";
import { sendWeaveChatMessage } from "./client.js";
import { weaveChatPluginConfigSchema } from "./config-schema.js";
import { DEFAULT_WEAVE_CHAT_ACCOUNT_ID, WEAVE_CHAT_CHANNEL_ID } from "./constants.js";
import { registerWeaveChatInboundRuntimeContext } from "./inbound.js";
import type { CoreConfig, ResolvedWeaveChatAccount } from "./types.js";
import { buildWeaveChatApprovalHintEvent } from "./weave-chat-contract.js";

const meta = {
  ...getChatChannelMeta(WEAVE_CHAT_CHANNEL_ID),
  id: WEAVE_CHAT_CHANNEL_ID,
  label: "Weave Chat",
  selectionLabel: "Weave Chat",
  docsPath: "/channels/weave-chat",
  blurb: "Weave-governed chat transport; provider routing stays behind Weave.",
};

const status = createComputedAccountStatusAdapter<ResolvedWeaveChatAccount>({
  defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_WEAVE_CHAT_ACCOUNT_ID),
  buildChannelSummary: ({ snapshot }) => ({
    apiUrl: snapshot.apiUrl ?? "[missing]",
    runtimeProfileHash: snapshot.runtimeProfileHash,
  }),
  resolveAccountSnapshot: ({ account }) => ({
    accountId: account.accountId,
    enabled: account.enabled,
    configured: account.configured,
    extra: {
      apiUrl: account.apiUrl,
      runtimeProfileHash: account.runtimeProfileHash,
      runtimeProfileVersion: account.runtimeProfileVersion,
      userRuntimeId: account.userRuntimeId,
    },
  }),
});

function buildApprovalPayload(params: {
  request: {
    id?: string;
    command?: string;
    pluginName?: string;
    toolName?: string;
  };
  kind: "exec" | "plugin" | "tool";
  nowMs: number;
}) {
  const approvalId = String(params.request.id ?? "approval");
  const target =
    params.request.command ?? params.request.pluginName ?? params.request.toolName ?? params.kind;
  const text = [
    "Approval required",
    `Action: ${params.kind}`,
    `Target: ${target}`,
    "Risk: this may take an action outside the current chat.",
    "Options: approve, deny, or open details.",
  ].join("\n");
  const event = buildWeaveChatApprovalHintEvent({
    sessionKey: `${WEAVE_CHAT_CHANNEL_ID}:approval:${approvalId}`,
    approvalId,
    correlationId: `${approvalId}:${params.nowMs}`,
    turnId: approvalId,
    text,
    options: [
      { id: "approve", label: "Approve" },
      { id: "deny", label: "Deny" },
      { id: "open", label: "Open details" },
    ],
  });
  return {
    text: event.text,
    isStatusNotice: true,
    channelData: {
      weaveChat: {
        eventType: "approval.prompt",
        approval: event,
      },
    },
  };
}

const message = defineChannelMessageAdapter({
  id: WEAVE_CHAT_CHANNEL_ID,
  durableFinal: {
    capabilities: {
      text: true,
      thread: true,
      replyTo: true,
      messageSendingHooks: true,
    },
  },
  send: {
    text: async (ctx) => {
      const account = resolveWeaveChatAccount({
        cfg: ctx.cfg as CoreConfig,
        accountId: ctx.accountId,
      });
      if (!account.configured) {
        throw new Error("Weave Chat is not configured by the active RuntimeProfile");
      }
      const result = await sendWeaveChatMessage({
        account,
        request: {
          target: ctx.to,
          text: ctx.text,
          threadId: ctx.threadId == null ? undefined : String(ctx.threadId),
          replyToId: ctx.replyToId ?? undefined,
          runtimeProfileHash: account.runtimeProfileHash,
          runtimeProfileVersion: account.runtimeProfileVersion,
          userRuntimeId: account.userRuntimeId,
        },
      });
      const threadId = ctx.threadId == null ? undefined : String(ctx.threadId);
      const replyToId = ctx.replyToId ?? undefined;
      return {
        messageId: result.messageId,
        receipt: createMessageReceiptFromOutboundResults({
          results: [{ channel: WEAVE_CHAT_CHANNEL_ID, messageId: result.messageId }],
          threadId,
          replyToId,
          kind: "text",
        }),
      };
    },
  },
});

export const weaveChatPlugin: ChannelPlugin<ResolvedWeaveChatAccount> = createChatChannelPlugin({
  base: {
    id: WEAVE_CHAT_CHANNEL_ID,
    meta,
    capabilities: {
      chatTypes: ["direct", "group"],
    },
    reload: { configPrefixes: ["channels.weave-chat"] },
    configSchema: weaveChatPluginConfigSchema,
    config: {
      listAccountIds: (cfg) => listWeaveChatAccountIds(cfg as CoreConfig),
      resolveAccount: (cfg, accountId) =>
        resolveWeaveChatAccount({ cfg: cfg as CoreConfig, accountId }),
      defaultAccountId: (cfg) => resolveDefaultWeaveChatAccountId(cfg as CoreConfig),
      isConfigured: (account) => account.configured,
      resolveDefaultTo: ({ cfg, accountId }) =>
        resolveWeaveChatAccount({ cfg: cfg as CoreConfig, accountId }).defaultTo,
    },
    messaging: {
      normalizeTarget: (raw) => raw.trim(),
      inferTargetChatType: () => "group",
      targetResolver: {
        looksLikeId: (raw) => raw.trim().length > 0,
        hint: "<Weave chat target>",
      },
      resolveOutboundSessionRoute: ({ cfg, agentId, accountId, target }) =>
        buildChannelOutboundSessionRoute({
          cfg,
          agentId,
          channel: WEAVE_CHAT_CHANNEL_ID,
          accountId,
          peer: {
            kind: "group",
            id: target,
          },
          chatType: "group",
          from: `${WEAVE_CHAT_CHANNEL_ID}:${accountId ?? DEFAULT_WEAVE_CHAT_ACCOUNT_ID}`,
          to: target,
        }),
    },
    status,
    approvalCapability: {
      render: {
        exec: {
          buildPendingPayload: ({ request, nowMs }) =>
            buildApprovalPayload({ request, kind: "exec", nowMs }),
        },
        plugin: {
          buildPendingPayload: ({ request, nowMs }) =>
            buildApprovalPayload({ request, kind: "plugin", nowMs }),
        },
      },
    },
    gateway: {
      startAccount: async (ctx) => {
        const account = ctx.account;
        if (!account.configured) {
          throw new Error(`Weave Chat is not configured for account "${account.accountId}"`);
        }
        ctx.setStatus({
          accountId: account.accountId,
          running: true,
          configured: true,
          enabled: account.enabled,
          apiUrl: account.apiUrl,
          runtimeProfileHash: account.runtimeProfileHash,
        });
        if (ctx.channelRuntime) {
          registerWeaveChatInboundRuntimeContext({
            cfg: ctx.cfg as CoreConfig,
            account,
            runtime: ctx.channelRuntime as PluginRuntime["channel"],
            abortSignal: ctx.abortSignal,
          });
        }
        // The actual HTTP webhook/event-stream route stays outside the ChannelPlugin SDK.
        // Register the inbound runtime handler here so Weaver's outer boundary can resolve it.
        await new Promise<void>((resolve) => {
          if (ctx.abortSignal.aborted) {
            resolve();
            return;
          }
          ctx.abortSignal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        ctx.setStatus({ accountId: account.accountId, running: false });
      },
    },
    message,
  },
});
