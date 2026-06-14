import { describe, expect, it, vi } from "vitest";
import type { SessionMcpRuntime } from "../agents/agent-bundle-mcp-types.js";
import type { GeneratedWeaverConfig } from "./runtime-profile.js";
import { runWeaveChatToolCallHarness } from "./weave-chat-tool-call-harness.js";

function createGeneratedConfig(overrides?: Partial<GeneratedWeaverConfig>): GeneratedWeaverConfig {
  return {
    generatedBy: "weaver-runtime-profile",
    runtimeProfileHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    runtimeProfileVersion: 7,
    memberConfigLocked: true,
    models: {
      aliases: { fast: "lmstudio/qwen/qwen3.5-9b" },
      default: "fast",
      fallbacks: [],
    },
    channels: {
      "weave-chat": {
        apiUrl: "https://weave.example.org",
        userRuntimeId: "runtime-user-1",
        runtimeProfileHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        runtimeProfileVersion: 7,
        runtimeTokenRef: { source: "runtime-token", id: "chat-token" },
        credentialRefs: {},
      },
    },
    mcp: {
      servers: {
        "weave-domain-tools": {
          transport: "streamable-http",
          url: "https://weave.example.org/runtime/mcp",
          requestTimeoutMs: 240000,
        },
      },
    },
    mcpPolicy: { allowBundleMcp: false, allowedPersonalConnections: ["weave-domain-tools"] },
    skills: { allow: [], deny: [] },
    tools: { allow: ["mcp:weave-domain-tools:calendar.search_events"], deny: ["exec", "write"] },
    sandbox: {},
    memberMode: {
      rawConfigLocked: true,
      allowedControls: [
        "style",
        "memory",
        "model-alias-selection",
        "allowed-skills",
        "workspace-preferences",
        "personal-mcp-connections",
      ],
      deniedSurfaces: ["openclaw.json"],
      denialMessage: "locked",
      operatorSupport: { enabled: false },
    },
    audit: {
      mode: "required",
      runtimeProfileHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      runtimeProfileVersion: 7,
      userId: "user-1",
      domain: "example.org",
      providerRefs: [],
      credentialRefs: [],
    },
    ...overrides,
  };
}

function createRuntimeMock(): SessionMcpRuntime {
  return {
    sessionId: "weave-chat-tool-call-test",
    workspaceDir: "/tmp/weave-chat-tool-call-test",
    configFingerprint: "fingerprint",
    createdAt: 0,
    lastUsedAt: 0,
    getCatalog: vi.fn(async () => ({
      version: 1,
      generatedAt: Date.now(),
      servers: {
        "weave-domain-tools": {
          serverName: "weave-domain-tools",
          safeServerName: "weave-domain-tools",
          launchSummary: "ok",
          toolCount: 1,
        },
      },
      tools: [
        {
          serverName: "weave-domain-tools",
          safeServerName: "weave-domain-tools",
          toolName: "calendar.search_events",
          description: "Search events",
          fallbackDescription: "Search events",
          inputSchema: {
            type: "object",
            properties: {
              from: { type: "string" },
            },
            additionalProperties: false,
          },
        },
      ],
      diagnostics: [],
    })),
    peekCatalog: vi.fn(() => null),
    markUsed: vi.fn(),
    callTool: vi.fn(async () => ({
      structuredContent: {
        items: [
          {
            startsAt: "2026-06-15T09:00:00Z",
            titlePresent: true,
          },
        ],
      },
      content: [],
      isError: false,
    })),
    dispose: vi.fn(async () => undefined),
  };
}

describe("runWeaveChatToolCallHarness", () => {
  it("proves a same-turn local-model tool call roundtrip with explicit long timeout", async () => {
    const runtime = createRuntimeMock();
    const fetchImpl: typeof fetch = vi.fn(async (_input, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as {
        messages: Array<Record<string, unknown>>;
      };
      const toolMessages = payload.messages.filter((message) => message.role === "tool");
      if (toolMessages.length === 0) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "weave_domain_tools__calendar_search_events",
                        arguments: JSON.stringify({ from: "2026-06-15" }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "Ich habe einen Termin am 15.06. um 09:00 gefunden.",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const evidence = await runWeaveChatToolCallHarness(createGeneratedConfig(), {
      baseUrl: "http://lmstudio.internal:1234/v1",
      modelRef: "lmstudio/qwen/qwen3.5-9b",
      prompt: "Welche Termine habe ich morgen?",
      timeoutMs: 240_000,
      getSessionMcpRuntime: vi.fn(async () => runtime),
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(runtime.callTool).toHaveBeenCalledWith("weave-domain-tools", "calendar.search_events", {
      from: "2026-06-15",
    });
    expect(evidence).toMatchObject({
      schemaVersion: 1,
      channelId: "weave-chat",
      modelRef: "lmstudio/qwen/qwen3.5-9b",
      requestModel: "qwen/qwen3.5-9b",
      discoveryStatus: "discovered",
      finalText: "Ich habe einen Termin am 15.06. um 09:00 gefunden.",
      toolInventory: [
        {
          openAiName: "weave_domain_tools__calendar_search_events",
          serverName: "weave-domain-tools",
          toolName: "calendar.search_events",
        },
      ],
    });
    expect(evidence.rounds).toEqual([
      {
        kind: "model_tool_request",
        finishReason: "tool_calls",
        requestedTools: [
          {
            openAiName: "weave_domain_tools__calendar_search_events",
            serverName: "weave-domain-tools",
            toolName: "calendar.search_events",
          },
        ],
      },
      {
        kind: "tool_result",
        openAiName: "weave_domain_tools__calendar_search_events",
        serverName: "weave-domain-tools",
        toolName: "calendar.search_events",
        resultPreview: JSON.stringify({
          items: [{ startsAt: "2026-06-15T09:00:00Z", titlePresent: true }],
        }),
      },
      {
        kind: "final_answer",
        finishReason: "stop",
        visibleText: "Ich habe einen Termin am 15.06. um 09:00 gefunden.",
      },
    ]);
    expect(runtime.dispose).toHaveBeenCalled();
  });

  it("fails closed when the model requests an unknown or disallowed tool", async () => {
    const runtime = createRuntimeMock();
    const fetchImpl: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "weave_domain_tools__boards_comment",
                        arguments: "{}",
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as typeof fetch;

    await expect(
      runWeaveChatToolCallHarness(createGeneratedConfig(), {
        baseUrl: "http://lmstudio.internal:1234/v1",
        modelRef: "lmstudio/qwen/qwen3.5-9b",
        prompt: "Kommentiere das Board.",
        getSessionMcpRuntime: vi.fn(async () => runtime),
        fetchImpl,
      }),
    ).rejects.toThrow(/unknown or disallowed RuntimeProfile tool/i);
    expect(runtime.callTool).not.toHaveBeenCalled();
  });

  it("fails closed on malformed or schema-invalid tool arguments", async () => {
    const runtime = createRuntimeMock();
    const badJsonFetch: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "weave_domain_tools__calendar_search_events",
                        arguments: "{bad json",
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as typeof fetch;

    await expect(
      runWeaveChatToolCallHarness(createGeneratedConfig(), {
        baseUrl: "http://lmstudio.internal:1234/v1",
        modelRef: "lmstudio/qwen/qwen3.5-9b",
        prompt: "Welche Termine habe ich morgen?",
        getSessionMcpRuntime: vi.fn(async () => runtime),
        fetchImpl: badJsonFetch,
      }),
    ).rejects.toThrow(/malformed JSON arguments/i);

    const badSchemaFetch: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  tool_calls: [
                    {
                      id: "call_2",
                      type: "function",
                      function: {
                        name: "weave_domain_tools__calendar_search_events",
                        arguments: JSON.stringify({ from: "2026-06-15", extra: true }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as typeof fetch;

    await expect(
      runWeaveChatToolCallHarness(createGeneratedConfig(), {
        baseUrl: "http://lmstudio.internal:1234/v1",
        modelRef: "lmstudio/qwen/qwen3.5-9b",
        prompt: "Welche Termine habe ich morgen?",
        getSessionMcpRuntime: vi.fn(async () => runtime),
        fetchImpl: badSchemaFetch,
      }),
    ).rejects.toThrow(/failed schema validation/i);
    expect(runtime.callTool).not.toHaveBeenCalled();
  });

  it("uses the explicit long timeout and fails closed when the local model stalls", async () => {
    const runtime = createRuntimeMock();
    const fetchImpl: typeof fetch = vi.fn(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    ) as typeof fetch;

    await expect(
      runWeaveChatToolCallHarness(createGeneratedConfig(), {
        baseUrl: "http://lmstudio.internal:1234/v1",
        modelRef: "lmstudio/qwen/qwen3.5-9b",
        prompt: "Welche Termine habe ich morgen?",
        timeoutMs: 25,
        getSessionMcpRuntime: vi.fn(async () => runtime),
        fetchImpl,
      }),
    ).rejects.toThrow(/timed out after 25ms/i);
    expect(runtime.callTool).not.toHaveBeenCalled();
  });
});
