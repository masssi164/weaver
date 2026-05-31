import {
  buildChannelOutboundSessionRoute,
  createChatChannelPlugin,
} from "openclaw/plugin-sdk/channel-core";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
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
import type { CoreConfig, ResolvedWeaveChatAccount } from "./types.js";

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
          replyToId: ctx.replyToId == null ? undefined : String(ctx.replyToId),
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
        // The actual inbound adapter is the Weave webhook/event-stream boundary.
        // It must dispatch only Weave Chat events; providerRef routing remains backend-only.
        await new Promise<void>((resolve) => {
          if (ctx.abortSignal.aborted) {
            resolve();
            return;
          }
          ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
        });
        ctx.setStatus({ accountId: account.accountId, running: false });
      },
    },
    message,
  },
});
