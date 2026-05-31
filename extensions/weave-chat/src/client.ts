import type {
  ResolvedWeaveChatAccount,
  WeaveChatSendRequest,
  WeaveChatSendResult,
} from "./types.js";

export function buildWeaveChatSendBoundary(params: {
  account: ResolvedWeaveChatAccount;
  request: WeaveChatSendRequest;
}) {
  return {
    url: new URL("/runtime/chat/messages", params.account.apiUrl).toString(),
    method: "POST" as const,
    headers: {
      "content-type": "application/json",
      "x-weave-runtime-profile-hash": params.account.runtimeProfileHash,
      "x-weave-runtime-profile-version": String(params.account.runtimeProfileVersion),
      "x-weave-user-runtime-id": params.account.userRuntimeId,
      "x-weave-runtime-token-ref": `${params.account.runtimeTokenRef.source}:${params.account.runtimeTokenRef.id}`,
    },
    body: {
      target: params.request.target,
      text: params.request.text,
      threadId: params.request.threadId,
      replyToId: params.request.replyToId,
      runtimeProfileHash: params.request.runtimeProfileHash,
      runtimeProfileVersion: params.request.runtimeProfileVersion,
      userRuntimeId: params.request.userRuntimeId,
    },
  };
}

export async function sendWeaveChatMessage(params: {
  account: ResolvedWeaveChatAccount;
  request: WeaveChatSendRequest;
  fetchImpl?: typeof fetch;
}): Promise<WeaveChatSendResult> {
  const boundary = buildWeaveChatSendBoundary(params);
  const response = await (params.fetchImpl ?? fetch)(boundary.url, {
    method: boundary.method,
    headers: boundary.headers,
    body: JSON.stringify(boundary.body),
  });
  if (!response.ok) {
    throw new Error(`Weave Chat send failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { messageId?: unknown };
  if (typeof payload.messageId !== "string" || payload.messageId.length === 0) {
    throw new Error("Weave Chat send response is missing messageId");
  }
  return { messageId: payload.messageId };
}
