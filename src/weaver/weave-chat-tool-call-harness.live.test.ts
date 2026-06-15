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

function createWeaveMcpHeaders(): Record<string, string> {
  const projection = process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_RUNTIME_PROFILE_PROJECTION;
  return {
    ...(process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_AUTHORIZATION
      ? { Authorization: process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_AUTHORIZATION }
      : {}),
    ...(process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_ORG_ID
      ? { "X-Weave-Org-Id": process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_ORG_ID }
      : {}),
    ...(process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_USER_REF
      ? { "X-Weave-User-Ref": process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_USER_REF }
      : {}),
    ...(process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_RUNTIME_PROFILE
      ? { "X-Weave-Runtime-Profile": process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_RUNTIME_PROFILE }
      : {}),
    ...(projection ? { "X-Weave-Runtime-Profile-Projection": projection } : {}),
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
          headers: createWeaveMcpHeaders(),
        },
      },
    },
    mcpPolicy: { allowBundleMcp: false, allowedPersonalConnections: ["weave-domain-tools"] },
    skills: { allow: [], deny: [] },
    tools: {
      allow: [
        "mcp:weave-domain-tools:calendar.search_events",
        "mcp:weave-domain-tools:calendar.read",
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
    "executes a same-turn LM Studio/Qwen calendar-read tool call through the real Weave MCP server",
    async () => {
      if (!MCP_URL) {
        throw new Error(
          "OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_URL must point at a real weave-domain-tools server; the live gate must not fall back to an in-process fixture.",
        );
      }
      const evidence = await runWeaveChatToolCallHarness(createGeneratedConfig(MCP_URL), {
        baseUrl: LMSTUDIO_BASE_URL,
        modelRef: MODEL_REF,
        prompt:
          "Nutze ausschließlich ein read-only Weave-Kalenderwerkzeug und antworte danach knapp support-sicher auf Deutsch: Welche Ereignisse gibt es heute im Kalender?",
        timeoutMs: LIVE_TIMEOUT_MS,
      });

      expect(evidence.channelId).toBe("weave-chat");
      expect(evidence.requestModel.length).toBeGreaterThan(0);
      expect(evidence.toolInventory.map((tool) => tool.toolName)).toEqual(
        expect.arrayContaining([expect.stringMatching(/^calendar\.(search_events|read)$/)]),
      );
      expect(evidence.toolInventory.some((tool) => tool.toolName === "calendar.create_event")).toBe(
        false,
      );
      expect(
        evidence.rounds.some(
          (round) =>
            round.kind === "model_tool_request" &&
            round.requestedTools.some((tool) =>
              /^calendar\.(search_events|read)$/.test(tool.toolName),
            ),
        ),
      ).toBe(true);
      expect(
        evidence.rounds.some(
          (round) =>
            round.kind === "tool_result" && /^calendar\.(search_events|read)$/.test(round.toolName),
        ),
      ).toBe(true);
      expect(evidence.rounds.at(-1)).toMatchObject({ kind: "final_answer" });
      expect(evidence.finalText.trim().length).toBeGreaterThan(0);
    },
    LIVE_TIMEOUT_MS + 30_000,
  );
});
