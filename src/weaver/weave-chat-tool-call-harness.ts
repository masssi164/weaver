import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createBundleMcpJsonSchemaValidator } from "../agents/agent-bundle-mcp-runtime.js";
import type { McpCatalogTool, SessionMcpRuntime } from "../agents/agent-bundle-mcp-types.js";
import { sanitizeAssistantVisibleText } from "../shared/text/assistant-visible-text.js";
import {
  discoverGeneratedWeaverMcpTools,
  WEAVE_DOMAIN_TOOLS_SERVER_NAME,
  type RuntimeProfileMcpDiscoveryOptions,
} from "./runtime-profile-mcp-discovery.js";
import {
  decideRuntimeProfileModelPolicy,
  decideRuntimeProfileToolPolicy,
  type GeneratedWeaverConfig,
} from "./runtime-profile.js";

const DEFAULT_LOCAL_MODEL_TIMEOUT_MS = 240_000;
const DEFAULT_MAX_TOOL_ROUNDS = 4;
const OPENAI_TOOL_NAME_SEPARATOR = "__";

type OpenAiToolSpec = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type OpenAiChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: OpenAiToolCall[];
};

type OpenAiToolCall = {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type OpenAiChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: unknown;
      reasoning_content?: unknown;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
};

export type WeaveChatToolCallHarnessEvidence = {
  schemaVersion: 1;
  runtimeProfileHash: string;
  runtimeProfileVersion: number;
  channelId: "weave-chat";
  modelRef: string;
  requestModel: string;
  discoveryStatus: string;
  toolInventory: Array<{ openAiName: string; serverName: string; toolName: string }>;
  rounds: Array<
    | {
        kind: "model_tool_request";
        finishReason: string;
        requestedTools: Array<{ openAiName: string; serverName: string; toolName: string }>;
      }
    | {
        kind: "tool_result";
        openAiName: string;
        serverName: string;
        toolName: string;
        resultPreview: string;
      }
    | {
        kind: "final_answer";
        finishReason: string;
        visibleText: string;
      }
  >;
  finalText: string;
};

export type WeaveChatToolCallHarnessOptions = RuntimeProfileMcpDiscoveryOptions & {
  baseUrl: string;
  modelRef: string;
  prompt: string;
  timeoutMs?: number;
  maxToolRounds?: number;
  fetchImpl?: typeof fetch;
};

type ToolCatalogEntry = {
  tool: McpCatalogTool;
  openAiName: string;
};

export async function runWeaveChatToolCallHarness(
  config: GeneratedWeaverConfig,
  options: WeaveChatToolCallHarnessOptions,
): Promise<WeaveChatToolCallHarnessEvidence> {
  const modelDecision = decideRuntimeProfileModelPolicy({ config, modelRef: options.modelRef });
  if (modelDecision.decision !== "allow") {
    throw new Error(modelDecision.reason);
  }

  const discovery = await discoverGeneratedWeaverMcpTools(config, options);
  if (discovery.supportSafeStatus !== "discovered") {
    throw new Error(discovery.diagnostics[0] ?? discovery.supportSafeStatus);
  }

  const runtime = await (options.getSessionMcpRuntime ?? importRuntime())({
    sessionId: options.sessionId ?? `weave-chat-tool-call-${config.runtimeProfileHash}`,
    sessionKey: options.sessionKey,
    workspaceDir: options.workspaceDir ?? process.cwd(),
    cfg: { mcp: config.mcp } as never,
  });

  try {
    const catalog = await runtime.getCatalog();
    const toolEntries = buildAllowedToolEntries(config, catalog.tools);
    const messages: OpenAiChatMessage[] = [{ role: "user", content: options.prompt }];
    const rounds: WeaveChatToolCallHarnessEvidence["rounds"] = [];
    const timeoutMs = options.timeoutMs ?? DEFAULT_LOCAL_MODEL_TIMEOUT_MS;
    const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    const requestModel = normalizeRequestModel(options.modelRef);

    for (let round = 0; round < maxToolRounds; round += 1) {
      const completion = await fetchChatCompletion({
        baseUrl: options.baseUrl,
        model: requestModel,
        timeoutMs,
        fetchImpl: options.fetchImpl ?? fetch,
        messages,
        tools: toolEntries.map(toOpenAiTool),
      });
      const choice = completion.choices?.[0];
      const finishReason =
        typeof choice?.finish_reason === "string" ? choice.finish_reason : "stop";
      const message = choice?.message;
      const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];

      if (toolCalls.length > 0) {
        const resolvedToolCalls = toolCalls.map((toolCall, index) =>
          resolveRequestedToolCall({ config, toolCall, toolEntries, index }),
        );
        rounds.push({
          kind: "model_tool_request",
          finishReason,
          requestedTools: resolvedToolCalls.map((entry) => ({
            openAiName: entry.openAiName,
            serverName: entry.tool.serverName,
            toolName: entry.tool.toolName,
          })),
        });
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: toolCalls.map((toolCall, index) => ({
            id: toolCall.id ?? `tool_call_${index + 1}`,
            type: "function",
            function: {
              name: resolvedToolCalls[index]?.openAiName,
              arguments: toolCall.function?.arguments ?? "{}",
            },
          })),
        });
        for (const entry of resolvedToolCalls) {
          const result = await runtime.callTool(
            entry.tool.serverName,
            entry.tool.toolName,
            entry.args,
          );
          const resultText = stringifyToolResult(result);
          rounds.push({
            kind: "tool_result",
            openAiName: entry.openAiName,
            serverName: entry.tool.serverName,
            toolName: entry.tool.toolName,
            resultPreview: resultText,
          });
          messages.push({
            role: "tool",
            tool_call_id: entry.id,
            name: entry.openAiName,
            content: resultText,
          });
        }
        continue;
      }

      const visibleText = sanitizeModelOutput(message?.content);
      if (!visibleText) {
        throw new Error("Model did not return a support-safe final answer.");
      }
      rounds.push({ kind: "final_answer", finishReason, visibleText });
      return {
        schemaVersion: 1,
        runtimeProfileHash: config.runtimeProfileHash,
        runtimeProfileVersion: config.runtimeProfileVersion,
        channelId: "weave-chat",
        modelRef: options.modelRef,
        requestModel,
        discoveryStatus: discovery.supportSafeStatus,
        toolInventory: toolEntries.map((entry) => ({
          openAiName: entry.openAiName,
          serverName: entry.tool.serverName,
          toolName: entry.tool.toolName,
        })),
        rounds,
        finalText: visibleText,
      };
    }

    throw new Error(`Model exceeded ${maxToolRounds} tool-call rounds without a final answer.`);
  } finally {
    await runtime.dispose();
  }
}

function importRuntime() {
  return requireGetSessionMcpRuntime;
}

async function requireGetSessionMcpRuntime(params: {
  sessionId: string;
  sessionKey?: string;
  workspaceDir: string;
  cfg: unknown;
}) {
  const mod = await import("../agents/agent-bundle-mcp-tools.js");
  return mod.getOrCreateSessionMcpRuntime(params);
}

function buildAllowedToolEntries(
  config: GeneratedWeaverConfig,
  tools: readonly McpCatalogTool[],
): ToolCatalogEntry[] {
  return tools
    .filter((tool) => tool.serverName === WEAVE_DOMAIN_TOOLS_SERVER_NAME)
    .filter(
      (tool) =>
        decideRuntimeProfileToolPolicy({
          config,
          tool: tool.toolName,
          action: `mcp:${tool.serverName}:${tool.toolName}`,
        }).decision === "allow",
    )
    .map((tool) => ({
      tool,
      openAiName: encodeOpenAiToolName(tool.serverName, tool.toolName),
    }))
    .toSorted((left, right) => left.openAiName.localeCompare(right.openAiName));
}

function toOpenAiTool(entry: ToolCatalogEntry): OpenAiToolSpec {
  return {
    type: "function",
    function: {
      name: entry.openAiName,
      description: entry.tool.description ?? entry.tool.fallbackDescription,
      parameters: entry.tool.inputSchema as Record<string, unknown>,
    },
  };
}

function encodeOpenAiToolName(serverName: string, toolName: string): string {
  return `${sanitizeToolNamePart(serverName)}${OPENAI_TOOL_NAME_SEPARATOR}${sanitizeToolNamePart(toolName)}`;
}

function sanitizeToolNamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_");
}

function normalizeRequestModel(modelRef: string): string {
  const trimmed = modelRef.trim();
  return trimmed.startsWith("lmstudio/") ? trimmed.slice("lmstudio/".length) : trimmed;
}

function resolveRequestedToolCall(params: {
  config: GeneratedWeaverConfig;
  toolCall: OpenAiToolCall;
  toolEntries: readonly ToolCatalogEntry[];
  index: number;
}) {
  const id = params.toolCall.id ?? `tool_call_${params.index + 1}`;
  const openAiName = params.toolCall.function?.name?.trim();
  if (!openAiName) {
    throw new Error("Model returned a malformed tool call without a function name.");
  }
  const entry = params.toolEntries.find((candidate) => candidate.openAiName === openAiName);
  if (!entry) {
    throw new Error(`Model requested an unknown or disallowed RuntimeProfile tool: ${openAiName}`);
  }
  const decision = decideRuntimeProfileToolPolicy({
    config: params.config,
    tool: entry.tool.toolName,
    action: `mcp:${entry.tool.serverName}:${entry.tool.toolName}`,
  });
  if (decision.decision !== "allow") {
    throw new Error(decision.reason);
  }
  const rawArguments = params.toolCall.function?.arguments ?? "{}";
  let args: unknown;
  try {
    args = JSON.parse(rawArguments);
  } catch {
    throw new Error(`Model returned malformed JSON arguments for ${openAiName}.`);
  }
  const validator = createBundleMcpJsonSchemaValidator().getValidator(
    entry.tool.inputSchema as never,
  );
  const validation = validator(args);
  if (!validation.valid) {
    throw new Error(
      `Model arguments failed schema validation for ${openAiName}: ${validation.errorMessage}`,
    );
  }
  return { id, openAiName, tool: entry.tool, args: validation.data };
}

async function fetchChatCompletion(params: {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  messages: OpenAiChatMessage[];
  tools: OpenAiToolSpec[];
}): Promise<OpenAiChatCompletionResponse> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Local model request timed out.")),
    params.timeoutMs,
  );
  try {
    const response = await params.fetchImpl(
      `${params.baseUrl.replace(/\/+$/u, "")}/chat/completions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: params.model,
          messages: params.messages,
          tools: params.tools,
          tool_choice: "auto",
          parallel_tool_calls: false,
          stream: false,
          temperature: 0,
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error(`Local model chat completion failed with HTTP ${response.status}`);
    }
    return (await response.json()) as OpenAiChatCompletionResponse;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Local model chat completion timed out after ${params.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function stringifyToolResult(result: CallToolResult): string {
  if (result.structuredContent !== undefined) {
    return JSON.stringify(result.structuredContent);
  }
  if (Array.isArray(result.content) && result.content.length > 0) {
    return result.content
      .map((entry) => {
        if (
          entry &&
          typeof entry === "object" &&
          "text" in entry &&
          typeof entry.text === "string"
        ) {
          return entry.text;
        }
        return JSON.stringify(entry);
      })
      .join("\n");
  }
  return JSON.stringify({ status: result.isError === true ? "error" : "ok" });
}

function sanitizeModelOutput(content: unknown): string {
  if (typeof content === "string") {
    return sanitizeAssistantVisibleText(content);
  }
  if (Array.isArray(content)) {
    const text = content
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (
          entry &&
          typeof entry === "object" &&
          "text" in entry &&
          typeof (entry as { text?: unknown }).text === "string"
        ) {
          return (entry as { text: string }).text;
        }
        return "";
      })
      .join("\n");
    return sanitizeAssistantVisibleText(text);
  }
  return "";
}
