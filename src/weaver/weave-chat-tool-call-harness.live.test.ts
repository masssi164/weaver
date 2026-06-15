import { randomUUID } from "node:crypto";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { isLiveTestEnabled } from "../agents/live-test-helpers.js";
import type { GeneratedWeaverConfig } from "./runtime-profile.js";
import { runWeaveChatToolCallHarness } from "./weave-chat-tool-call-harness.js";

const LIVE = isLiveTestEnabled(["OPENCLAW_LIVE_QWEN_TOOLCALL"]);
const describeLive = LIVE ? describe : describe.skip;
const LIVE_TIMEOUT_MS = Number(process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_TIMEOUT_MS ?? "300000");
const LMSTUDIO_BASE_URL =
  process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_BASE_URL ?? "http://127.0.0.1:1234/v1";
const MODEL_REF = process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MODEL ?? "lmstudio/qwen/qwen3.5-9b";
const MCP_URL = process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_URL;

async function startLocalWeaveDomainToolsServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const mcpServer = new McpServer({ name: "weave-domain-tools-live-probe", version: "1.0.0" });
  mcpServer.tool("calendar.search_events", "Search read-only calendar events", async () => ({
    structuredContent: {
      items: [
        {
          startsAt: "2026-06-16T09:00:00+02:00",
          titlePresent: true,
          supportSafeSummary: "A calendar event exists tomorrow morning.",
        },
      ],
    },
    content: [
      { type: "text", text: "Morgen gibt es einen support-sicheren Kalendereintrag am Vormittag." },
    ],
  }));
  mcpServer.tool("files.search", "Search read-only file metadata", async () => ({
    structuredContent: { items: [] },
    content: [{ type: "text", text: "Keine passenden Dateien gefunden." }],
  }));

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  await mcpServer.connect(transport);
  const httpServer = http.createServer(async (req, res) => {
    if (!req.url?.startsWith("/mcp")) {
      res.writeHead(404).end();
      return;
    }
    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      console.warn(`Weave domain tools live probe failed to handle MCP request: ${String(error)}`);
      if (!res.headersSent) {
        res.writeHead(500).end();
      } else {
        res.end();
      }
    }
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      await transport.close().catch(() => undefined);
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function createGeneratedConfig(mcpUrl: string): GeneratedWeaverConfig {
  return {
    generatedBy: "weaver-runtime-profile",
    runtimeProfileHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    runtimeProfileVersion: 7,
    memberConfigLocked: true,
    models: {
      aliases: { default: MODEL_REF },
      default: "default",
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
          url: mcpUrl,
          requestTimeoutMs: LIVE_TIMEOUT_MS,
        },
      },
    },
    mcpPolicy: { allowBundleMcp: false, allowedPersonalConnections: ["weave-domain-tools"] },
    skills: { allow: [], deny: [] },
    tools: {
      allow: [
        "mcp:weave-domain-tools:calendar.search_events",
        "mcp:weave-domain-tools:files.search",
      ],
      deny: ["exec", "write", "apply_patch"],
    },
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
  };
}

describeLive("weave chat tool-call harness (live)", () => {
  it(
    "executes a same-turn LM Studio/Qwen tool call through Weave MCP and returns a final answer",
    async () => {
      const probeServer = MCP_URL ? undefined : await startLocalWeaveDomainToolsServer();
      try {
        const evidence = await runWeaveChatToolCallHarness(
          createGeneratedConfig(MCP_URL ?? probeServer!.url),
          {
            baseUrl: LMSTUDIO_BASE_URL,
            modelRef: MODEL_REF,
            prompt:
              "Nutze ein verfügbares read-only Weave-Werkzeug für Kalendertermine und antworte danach knapp auf Deutsch: Welche support-sicheren Informationen kannst du zu morgigen Kalenderterminen finden?",
            timeoutMs: LIVE_TIMEOUT_MS,
          },
        );

        expect(evidence.channelId).toBe("weave-chat");
        expect(evidence.requestModel.length).toBeGreaterThan(0);
        expect(evidence.toolInventory.length).toBeGreaterThan(0);
        expect(evidence.rounds.some((round) => round.kind === "model_tool_request")).toBe(true);
        expect(evidence.rounds.some((round) => round.kind === "tool_result")).toBe(true);
        expect(evidence.rounds.at(-1)).toMatchObject({ kind: "final_answer" });
        expect(evidence.finalText.trim().length).toBeGreaterThan(0);
      } finally {
        await probeServer?.close();
      }
    },
    LIVE_TIMEOUT_MS + 30_000,
  );
});
