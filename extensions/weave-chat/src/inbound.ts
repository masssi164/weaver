import type { PluginRuntime } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import {
  createInboundEnvelopeBuilder,
  resolveInboundRouteEnvelopeBuilderWithRuntime,
} from "openclaw/plugin-sdk/inbound-envelope";
import { sendWeaveChatMessage } from "./client.js";
import { WEAVE_CHAT_CHANNEL_ID, WEAVE_CHAT_INBOUND_RUNTIME_CAPABILITY } from "./constants.js";
import type { CoreConfig, ResolvedWeaveChatAccount } from "./types.js";
import {
  buildWeaveChatFailureEvent,
  createInboundDeliveryGate,
  normalizeWeaveChatInboundMessage,
  type WeaveChatFailureCode,
  type WeaveChatInboundEvent,
} from "./weave-chat-contract.js";

export type WeaveChatInboundRuntime = PluginRuntime["channel"];
export type WeaveChatInboundRuntimeContext = {
  handleEvent: (event: WeaveChatInboundEvent) => Promise<{ duplicate: boolean }>;
};

function classifyDispatchFailure(error: unknown): WeaveChatFailureCode {
  const text = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (text.includes("timeout") || text.includes("timed out")) {
    return "model_timeout";
  }
  if (text.includes("offline") || text.includes("unavailable") || text.includes("not available")) {
    return "weaver_offline";
  }
  if (
    text.includes("profile") &&
    (text.includes("revoked") || text.includes("expired") || text.includes("invalid"))
  ) {
    return "profile_revoked";
  }
  return "api_failure";
}

export function createWeaveChatInboundRuntimeContext(params: {
  cfg: CoreConfig;
  account: ResolvedWeaveChatAccount;
  runtime: WeaveChatInboundRuntime;
}): WeaveChatInboundRuntimeContext {
  const gate = createInboundDeliveryGate();

  return {
    handleEvent: async (event) => {
      const normalized = normalizeWeaveChatInboundMessage({
        accountId: params.account.accountId,
        event,
      });
      const dedupe = gate.markIfDuplicate(event);
      if (dedupe.duplicate) {
        return { duplicate: true };
      }

      const resolved = resolveInboundRouteEnvelopeBuilderWithRuntime({
        cfg: params.cfg as OpenClawConfig,
        channel: WEAVE_CHAT_CHANNEL_ID,
        accountId: params.account.accountId,
        peer: {
          kind: "group",
          id: normalized.target,
        },
        runtime: params.runtime,
        sessionStore: params.cfg.session?.store,
      });
      const route = {
        agentId: resolved.route.agentId,
        sessionKey: normalized.sessionKey,
      };
      const buildEnvelope = createInboundEnvelopeBuilder({
        cfg: params.cfg as OpenClawConfig,
        route,
        sessionStore: params.cfg.session?.store,
        resolveStorePath: params.runtime.session.resolveStorePath,
        readSessionUpdatedAt: params.runtime.session.readSessionUpdatedAt,
        resolveEnvelopeFormatOptions: params.runtime.reply.resolveEnvelopeFormatOptions,
        formatAgentEnvelope: params.runtime.reply.formatAgentEnvelope,
      });
      const { storePath, body } = buildEnvelope({
        channel: "Weave Chat",
        from: `${event.scope.tenantId}/${event.scope.userId}`,
        timestamp: Date.parse(event.sentAt),
        body: normalized.text,
      });
      const ctxPayload = params.runtime.inbound.buildContext({
        channel: WEAVE_CHAT_CHANNEL_ID,
        accountId: params.account.accountId,
        messageId: normalized.messageId,
        messageIdFull: event.eventId,
        timestamp: Date.parse(event.sentAt),
        from: `${WEAVE_CHAT_CHANNEL_ID}:${event.scope.tenantId}/${event.scope.userId}`,
        sender: {
          id: normalized.userId,
          name: event.scope.userId,
        },
        conversation: {
          kind: "group",
          id: normalized.target,
          label: normalized.target,
          threadId: normalized.threadId,
          routePeer: {
            kind: "group",
            id: normalized.target,
          },
        },
        route: {
          agentId: route.agentId,
          accountId: params.account.accountId,
          routeSessionKey: route.sessionKey,
        },
        reply: {
          to: normalized.target,
          originatingTo: normalized.target,
          replyToId: normalized.threadId,
          replyToIdFull: normalized.threadId,
          messageThreadId: normalized.threadId,
        },
        message: {
          body,
          bodyForAgent: normalized.text,
          rawBody: normalized.text,
          commandBody: normalized.text,
        },
        extra: {
          ChatType: "group",
          MessageSid: normalized.messageId,
          MessageSidFull: event.eventId,
          OriginatingChannel: WEAVE_CHAT_CHANNEL_ID,
          OriginatingTo: normalized.target,
          Provider: WEAVE_CHAT_CHANNEL_ID,
          Surface: WEAVE_CHAT_CHANNEL_ID,
          SenderId: normalized.userId,
        },
      });

      try {
        await params.runtime.inbound.dispatchReply({
          cfg: params.cfg as OpenClawConfig,
          channel: WEAVE_CHAT_CHANNEL_ID,
          accountId: params.account.accountId,
          agentId: route.agentId,
          routeSessionKey: route.sessionKey,
          storePath,
          ctxPayload,
          recordInboundSession: params.runtime.session.recordInboundSession,
          dispatchReplyWithBufferedBlockDispatcher:
            params.runtime.reply.dispatchReplyWithBufferedBlockDispatcher,
          delivery: {
            deliver: async (payload) => {
              const text =
                payload && typeof payload === "object" && "text" in payload
                  ? ((payload as { text?: string }).text ?? "")
                  : "";
              if (!text.trim()) {
                return;
              }
              await sendWeaveChatMessage({
                account: params.account,
                request: {
                  target: normalized.target,
                  text,
                  threadId: normalized.threadId,
                  replyToId: normalized.messageId,
                  runtimeProfileHash: params.account.runtimeProfileHash,
                  runtimeProfileVersion: params.account.runtimeProfileVersion,
                  userRuntimeId: params.account.userRuntimeId,
                },
              });
            },
            onError: (error) => {
              throw error instanceof Error ? error : new Error(String(error));
            },
          },
        });
      } catch (error) {
        const failure = buildWeaveChatFailureEvent({
          sessionKey: normalized.sessionKey,
          correlationId: normalized.turnCorrelationId,
          turnId: normalized.turnCorrelationId,
          code: classifyDispatchFailure(error),
        });
        await sendWeaveChatMessage({
          account: params.account,
          request: {
            target: normalized.target,
            text: failure.text,
            threadId: normalized.threadId,
            replyToId: normalized.messageId,
            runtimeProfileHash: params.account.runtimeProfileHash,
            runtimeProfileVersion: params.account.runtimeProfileVersion,
            userRuntimeId: params.account.userRuntimeId,
            idempotencyKey: `${normalized.dedupeKey}:failure:${failure.code}`,
            deliveryStatus: failure.status,
          },
        });
        throw error;
      }

      return { duplicate: false };
    },
  };
}

export function registerWeaveChatInboundRuntimeContext(params: {
  cfg: CoreConfig;
  account: ResolvedWeaveChatAccount;
  runtime: WeaveChatInboundRuntime;
  abortSignal: AbortSignal;
}) {
  return params.runtime.runtimeContexts.register({
    channelId: WEAVE_CHAT_CHANNEL_ID,
    accountId: params.account.accountId,
    capability: WEAVE_CHAT_INBOUND_RUNTIME_CAPABILITY,
    context: createWeaveChatInboundRuntimeContext(params),
    abortSignal: params.abortSignal,
  });
}

export function getWeaveChatInboundRuntimeContext(params: {
  runtime: WeaveChatInboundRuntime;
  accountId?: string;
}) {
  return params.runtime.runtimeContexts.get<WeaveChatInboundRuntimeContext>({
    channelId: WEAVE_CHAT_CHANNEL_ID,
    accountId: params.accountId,
    capability: WEAVE_CHAT_INBOUND_RUNTIME_CAPABILITY,
  });
}
