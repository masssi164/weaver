import { describe, expect, it } from "vitest";
import { isLiveTestEnabled } from "../agents/live-test-helpers.js";
import type { GeneratedWeaverConfig } from "./runtime-profile.js";
import { runWeaveChatToolCallHarness } from "./weave-chat-tool-call-harness.js";

const LIVE = isLiveTestEnabled(["OPENCLAW_LIVE_QWEN_TOOLCALL"]);
const describeLive = LIVE ? describe : describe.skip;
const LIVE_TIMEOUT_MS = Number(process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_TIMEOUT_MS ?? "240000");
const LMSTUDIO_BASE_URL =
  process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_BASE_URL ?? "http://127.0.0.1:1234/v1";
const MODEL_REF = process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MODEL ?? "lmstudio/qwen/qwen3.5-9b";

function createGeneratedConfig(): GeneratedWeaverConfig {
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
          url: "http://127.0.0.1:8765/mcp",
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
      const evidence = await runWeaveChatToolCallHarness(createGeneratedConfig(), {
        baseUrl: LMSTUDIO_BASE_URL,
        modelRef: MODEL_REF,
        prompt:
          "Nutze wenn sinnvoll ein verfügbares read-only Weave-Werkzeug und antworte danach knapp auf Deutsch: Welche support-sicheren Informationen kannst du zu morgigen Kalenderterminen finden?",
        timeoutMs: LIVE_TIMEOUT_MS,
      });

      expect(evidence.channelId).toBe("weave-chat");
      expect(evidence.requestModel.length).toBeGreaterThan(0);
      expect(evidence.toolInventory.length).toBeGreaterThan(0);
      expect(evidence.rounds.some((round) => round.kind === "model_tool_request")).toBe(true);
      expect(evidence.rounds.some((round) => round.kind === "tool_result")).toBe(true);
      expect(evidence.rounds.at(-1)).toMatchObject({ kind: "final_answer" });
      expect(evidence.finalText.trim().length).toBeGreaterThan(0);
    },
    LIVE_TIMEOUT_MS + 30_000,
  );
});
