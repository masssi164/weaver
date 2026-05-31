import { decideRuntimeProfileToolPolicy, type GeneratedWeaverConfig } from "./runtime-profile.js";

const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

export const DEFAULT_LMSTUDIO_CONTAINER_BASE_URL = "https://lmstudio.home.internal/v1";
export const DEFAULT_LMSTUDIO_MODEL_REF = "lmstudio/qwen/qwen3.5-9b";
export const WEAVE_CHAT_ROUNDTRIP_PROMPT =
  "Reply with one short support-safe Weaver weave-chat readiness sentence.";

export type WeaveChatRoundTripMode = "offline" | "live";

export type WeaveChatRoundTripEvidence = {
  schemaVersion: 1;
  mode: WeaveChatRoundTripMode;
  channelId: "weave-chat";
  lmStudio: {
    baseUrl: string;
    containerVisible: true;
    modelRef: string;
    requestModel: string;
    liveCall: "skipped_offline" | "completed";
  };
  inbound: {
    messageId: string;
    channelId: "weave-chat";
    text: string;
  };
  modelResponse: {
    source: "offline-fixture" | "lmstudio-openai-compatible";
    text: string;
  };
  outbound: {
    messageId: string;
    channelId: "weave-chat";
    text: string;
  };
  runtimeProfilePolicy: {
    approvedReplyTool: "allow" | "deny";
    unsafeExecTool: "allow" | "deny";
  };
};

export type WeaveChatRoundTripOptions = {
  mode?: WeaveChatRoundTripMode;
  lmStudioBaseUrl?: string;
  modelRef?: string;
  fetchImpl?: typeof fetch;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
    text?: unknown;
  }>;
};

export function resolveWeaveChatRoundTripMode(
  env: Pick<NodeJS.ProcessEnv, "WEAVER_WEAVE_CHAT_ROUNDTRIP_LIVE"> = process.env,
): WeaveChatRoundTripMode {
  return TRUTHY_VALUES.has(env.WEAVER_WEAVE_CHAT_ROUNDTRIP_LIVE?.trim().toLowerCase() ?? "")
    ? "live"
    : "offline";
}

export function normalizeLmStudioRequestModel(modelRef: string): string {
  const trimmed = modelRef.trim();
  return trimmed.startsWith("lmstudio/") ? trimmed.slice("lmstudio/".length) : trimmed;
}

export function assertContainerVisibleLmStudioBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  const hostname = parsed.hostname.toLowerCase();
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (loopbackHosts.has(hostname) || hostname.startsWith("127.")) {
    throw new Error(
      "LM Studio live evidence must use a container-visible base URL such as https://lmstudio.home.internal/v1, not localhost.",
    );
  }
  return parsed.toString().replace(/\/+$/u, "");
}

export function createWeaveChatRoundTripPolicyConfig(): GeneratedWeaverConfig {
  return {
    generatedBy: "weaver-runtime-profile",
    runtimeProfileHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    runtimeProfileVersion: 1,
    memberConfigLocked: true,
    models: {
      aliases: { local: DEFAULT_LMSTUDIO_MODEL_REF },
      default: "local",
      fallbacks: [],
    },
    channels: {
      "weave-chat": {
        apiUrl: "https://weave.example.invalid",
        userRuntimeId: "runtime-weave-chat-harness",
        runtimeProfileHash:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        runtimeProfileVersion: 1,
        runtimeTokenRef: { source: "credential-broker", id: "weave-chat-runtime-token" },
        credentialRefs: {},
        webhookPath: "/runtime/weave-chat/webhook",
        eventStreamPath: "/runtime/weave-chat/events",
      },
    },
    mcp: [],
    mcpPolicy: { allowBundleMcp: false, allowedPersonalConnections: [] },
    skills: { allow: [], deny: [] },
    tools: { allow: ["message.send"], deny: ["exec"] },
    sandbox: { network: "weave-chat-and-approved-models" },
    memberMode: {
      rawConfigLocked: true,
      allowedControls: [],
      deniedSurfaces: [],
      denialMessage: "Weaver member runtime is governed by the Weave RuntimeProfile.",
      operatorSupport: { enabled: false },
    },
    audit: {
      mode: "required",
      runtimeProfileHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      runtimeProfileVersion: 1,
      userId: "weave-chat-harness-user",
      domain: "example.invalid",
      providerRefs: ["matrix:room-fixture"],
      credentialRefs: [],
    },
  };
}

export async function runWeaveChatRoundTripHarness(
  options: WeaveChatRoundTripOptions = {},
): Promise<WeaveChatRoundTripEvidence> {
  const mode = options.mode ?? resolveWeaveChatRoundTripMode();
  const modelRef = options.modelRef ?? DEFAULT_LMSTUDIO_MODEL_REF;
  const requestModel = normalizeLmStudioRequestModel(modelRef);
  const baseUrl = assertContainerVisibleLmStudioBaseUrl(
    options.lmStudioBaseUrl ?? DEFAULT_LMSTUDIO_CONTAINER_BASE_URL,
  );
  const inbound = {
    messageId: "inbound-weave-chat-fixture-1",
    channelId: "weave-chat" as const,
    text: WEAVE_CHAT_ROUNDTRIP_PROMPT,
  };
  const modelResponse =
    mode === "live"
      ? {
          source: "lmstudio-openai-compatible" as const,
          text: await fetchLmStudioChatCompletion({
            baseUrl,
            model: requestModel,
            prompt: inbound.text,
            fetchImpl: options.fetchImpl ?? fetch,
          }),
        }
      : {
          source: "offline-fixture" as const,
          text: "Offline Weaver weave-chat readiness fixture reached the outbound reply path.",
        };
  const outbound = {
    messageId: "outbound-weave-chat-fixture-1",
    channelId: "weave-chat" as const,
    text: modelResponse.text,
  };
  const policyConfig = createWeaveChatRoundTripPolicyConfig();

  return {
    schemaVersion: 1,
    mode,
    channelId: "weave-chat",
    lmStudio: {
      baseUrl,
      containerVisible: true,
      modelRef,
      requestModel,
      liveCall: mode === "live" ? "completed" : "skipped_offline",
    },
    inbound,
    modelResponse,
    outbound,
    runtimeProfilePolicy: {
      approvedReplyTool: decideRuntimeProfileToolPolicy({
        config: policyConfig,
        tool: "message.send",
      }).decision,
      unsafeExecTool: decideRuntimeProfileToolPolicy({ config: policyConfig, tool: "exec" })
        .decision,
    },
  };
}

async function fetchLmStudioChatCompletion(params: {
  baseUrl: string;
  model: string;
  prompt: string;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const response = await params.fetchImpl(`${params.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: params.model,
      messages: [{ role: "user", content: params.prompt }],
      temperature: 0,
      max_tokens: 64,
      stream: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`LM Studio chat completion failed with HTTP ${response.status}`);
  }
  const parsed = (await response.json()) as ChatCompletionResponse;
  const content = parsed.choices?.[0]?.message?.content ?? parsed.choices?.[0]?.text;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("LM Studio chat completion response did not include text content.");
  }
  return content.trim();
}
