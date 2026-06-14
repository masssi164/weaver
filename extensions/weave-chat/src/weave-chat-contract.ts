import { z } from "zod";
import { WEAVE_CHAT_CHANNEL_ID } from "./constants.js";

const WeaveScopeSchema = z
  .object({
    tenantId: z.string().min(1),
    orgId: z.string().min(1).optional(),
    userId: z.string().min(1),
    conversationId: z.string().min(1),
    spaceId: z.string().min(1).optional(),
    channelId: z.string().min(1).optional(),
    threadId: z.string().min(1).optional(),
  })
  .strict();

export const WeaveChatInboundEventSchema = z
  .object({
    kind: z.literal("message"),
    eventId: z.string().min(1),
    messageId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    deliveryCursor: z.string().min(1),
    sentAt: z.string().min(1),
    runtimeProfileHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    runtimeProfileVersion: z.number().int().positive(),
    scope: WeaveScopeSchema,
    text: z.string().min(1),
  })
  .strict();

export type WeaveChatInboundEvent = z.infer<typeof WeaveChatInboundEventSchema>;

export type WeaveChatNormalizedInboundMessage = {
  channelId: typeof WEAVE_CHAT_CHANNEL_ID;
  accountId: string;
  sessionKey: string;
  dedupeKey: string;
  turnCorrelationId: string;
  approvalCorrelationId: string;
  target: string;
  threadId?: string;
  messageId: string;
  userId: string;
  text: string;
  observability: ReturnType<typeof createInboundObservabilityEvent>;
};

const sanitizeSessionPart = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";

export function buildWeaveChatSessionKey(event: WeaveChatInboundEvent): string {
  const { tenantId, conversationId, threadId } = event.scope;
  const threadPart = threadId ? `:thread:${sanitizeSessionPart(threadId)}` : "";
  return `${WEAVE_CHAT_CHANNEL_ID}:tenant:${sanitizeSessionPart(tenantId)}:conversation:${sanitizeSessionPart(conversationId)}${threadPart}`;
}

export function buildWeaveChatDedupeKey(event: WeaveChatInboundEvent): string {
  return [WEAVE_CHAT_CHANNEL_ID, event.scope.tenantId, event.messageId, event.idempotencyKey].join(
    ":",
  );
}

export function createInboundObservabilityEvent(event: WeaveChatInboundEvent) {
  return {
    channel: WEAVE_CHAT_CHANNEL_ID,
    type: "channel_message_received",
    tenantId: event.scope.tenantId,
    conversationId: event.scope.conversationId,
    threadId: event.scope.threadId,
    messageId: event.messageId,
    eventId: event.eventId,
    deliveryCursor: event.deliveryCursor,
    runtimeProfileHash: event.runtimeProfileHash,
    runtimeProfileVersion: event.runtimeProfileVersion,
  } as const;
}

export function normalizeWeaveChatInboundMessage(params: {
  accountId?: string;
  event: WeaveChatInboundEvent;
}): WeaveChatNormalizedInboundMessage {
  const event = WeaveChatInboundEventSchema.parse(params.event);
  const sessionKey = buildWeaveChatSessionKey(event);
  const dedupeKey = buildWeaveChatDedupeKey(event);
  return {
    channelId: WEAVE_CHAT_CHANNEL_ID,
    accountId: params.accountId ?? "default",
    sessionKey,
    dedupeKey,
    turnCorrelationId: `${sessionKey}:turn:${sanitizeSessionPart(event.eventId)}`,
    approvalCorrelationId: `${sessionKey}:approval:${sanitizeSessionPart(event.eventId)}`,
    target: `${event.scope.tenantId}/${event.scope.conversationId}`,
    threadId: event.scope.threadId,
    messageId: event.messageId,
    userId: event.scope.userId,
    text: event.text,
    observability: createInboundObservabilityEvent(event),
  };
}

export function createInboundDeliveryGate() {
  const seen = new Set<string>();
  return {
    markIfDuplicate(event: WeaveChatInboundEvent) {
      const dedupeKey = buildWeaveChatDedupeKey(event);
      const duplicate = seen.has(dedupeKey);
      if (!duplicate) {
        seen.add(dedupeKey);
      }
      return {
        duplicate,
        dedupeKey,
        observability: {
          channel: WEAVE_CHAT_CHANNEL_ID,
          type: duplicate ? "channel_duplicate_ignored" : "channel_message_accepted",
          tenantId: event.scope.tenantId,
          messageId: event.messageId,
          idempotencyKey: event.idempotencyKey,
        } as const,
      };
    },
  };
}

export function buildWeaveChatApprovalHintEvent(params: {
  sessionKey: string;
  approvalId: string;
  correlationId: string;
  turnId: string;
  text: string;
  options: Array<{ id: string; label: string }>;
}) {
  return {
    channel: WEAVE_CHAT_CHANNEL_ID,
    kind: "approval_hint",
    status: "pending",
    approvalId: params.approvalId,
    correlationId: params.correlationId,
    turnId: params.turnId,
    sessionKey: params.sessionKey,
    accessibility: {
      role: "group",
      label: "Approval required",
      description: params.text,
    },
    text: params.text,
    options: params.options.map((option) => ({
      id: option.id,
      label: option.label,
      accessibilityLabel: option.label,
    })),
  } as const;
}

export const WeaveChatFailureCodeSchema = z.enum([
  "weaver_offline",
  "model_timeout",
  "api_failure",
  "profile_revoked",
  "approval_denied",
  "approval_expired",
]);

export type WeaveChatFailureCode = z.infer<typeof WeaveChatFailureCodeSchema>;

const failureText: Record<WeaveChatFailureCode, string> = {
  weaver_offline: "Weaver is offline right now. Please retry shortly.",
  model_timeout: "The model took too long to respond. Please try again.",
  api_failure: "Weave Chat could not deliver the reply. Please retry.",
  profile_revoked: "This runtime profile is no longer valid. Reconnect Weaver to continue.",
  approval_denied: "That approval request was denied.",
  approval_expired: "That approval request expired before it was confirmed.",
};

export function buildWeaveChatFailureEvent(params: {
  sessionKey: string;
  correlationId: string;
  turnId: string;
  code: WeaveChatFailureCode;
}) {
  const code = WeaveChatFailureCodeSchema.parse(params.code);
  return {
    channel: WEAVE_CHAT_CHANNEL_ID,
    kind: "status",
    status: "failed",
    code,
    sessionKey: params.sessionKey,
    correlationId: params.correlationId,
    turnId: params.turnId,
    text: failureText[code],
    observability: {
      channel: WEAVE_CHAT_CHANNEL_ID,
      type: "channel_failure",
      code,
      correlationId: params.correlationId,
      turnId: params.turnId,
    },
  } as const;
}
