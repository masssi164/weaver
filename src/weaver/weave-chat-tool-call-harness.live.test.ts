import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isLiveTestEnabled } from "../agents/live-test-helpers.js";
import type { GeneratedWeaverConfig } from "./runtime-profile.js";
import {
  runWeaveChatToolCallHarness,
  type WeaveChatToolCallHarnessEvidence,
} from "./weave-chat-tool-call-harness.js";

const LIVE = isLiveTestEnabled(["OPENCLAW_LIVE_QWEN_TOOLCALL"]);
const describeLive = LIVE ? describe : describe.skip;
const LIVE_TIMEOUT_MS = Number(process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_TIMEOUT_MS ?? "300000");
const LMSTUDIO_BASE_URL =
  process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_BASE_URL ?? "http://127.0.0.1:1234/v1";
const MODEL_REF = process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MODEL ?? "lmstudio/qwen/qwen3.5-9b";
const MCP_URL = process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_URL;
const ARTIFACT_DIR = process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_ARTIFACT_DIR ?? ".artifacts";
const SEED_TITLE =
  process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_SEEDED_TITLE ?? "Support-safe seeded calendar check";
const SEED_TIME = process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_SEEDED_TIME ?? "2026-06-16T09:00:00Z";
const SEED_REF_FRAGMENT =
  process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_SEEDED_REF_FRAGMENT ?? "calendar-event://redacted/";

type ScenarioEvidence = WeaveChatToolCallHarnessEvidence & {
  scenario: "empty" | "seeded";
  artifactPath?: string;
};

function createReadOnlyProjection(): Record<string, unknown> {
  return {
    runtimeProfileHash: "sha256:runtime-profile",
    runtimeProfileFetchRef: "weave-runtime-profile://sha256:runtime-profile",
    profileVersion: "v-live-read-only-calendar-evidence",
    expiresAt: "2099-01-01T00:00:00Z",
    enabled: true,
    revoked: false,
    serverKey: "weave-domain-tools",
    transport: "streamable-http",
    endpointRef: "internal://weave-mcp/streamable-http",
    credentialRef: "credentialref://weave/mcp/weave-domain-tools/runtime-token",
    runtimeTokenRef: "credentialref://weave/runtime/short-lived/live-evidence",
    runtimeTokenExpiresAt: "2099-01-01T00:00:00Z",
    capabilityGrants: ["weaver.calendar_read"],
    allowedTools: ["calendar.search_events"],
    alwaysAllowGrants: [],
    auditRef: "audit://mcp/runtime-profile/live-read-only-calendar-evidence",
    supportSafe: true,
    rawEndpointExposed: false,
  };
}

function createWeaveMcpHeaders(): Record<string, string> {
  const projection =
    process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_RUNTIME_PROFILE_PROJECTION ??
    Buffer.from(JSON.stringify(createReadOnlyProjection()), "utf8").toString("base64url");
  return {
    ...(process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_AUTHORIZATION
      ? {
          Authorization: process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_AUTHORIZATION,
        }
      : {}),
    ...(process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_ORG_ID
      ? { "X-Weave-Org-Id": process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_ORG_ID }
      : {}),
    ...(process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_USER_REF
      ? {
          "X-Weave-User-Ref": process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_USER_REF,
        }
      : {}),
    ...(process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_RUNTIME_PROFILE
      ? {
          "X-Weave-Runtime-Profile": process.env.OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_RUNTIME_PROFILE,
        }
      : {}),
    "X-Weave-Runtime-Profile-Projection": projection,
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
    mcpPolicy: {
      allowBundleMcp: false,
      allowedPersonalConnections: ["weave-domain-tools"],
    },
    skills: { allow: [], deny: [] },
    tools: {
      allow: ["mcp:weave-domain-tools:calendar.search_events"],
      deny: ["exec", "write", "apply_patch", "mcp:weave-domain-tools:calendar.create_event"],
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

async function writeEvidenceArtifact(evidence: ScenarioEvidence): Promise<string> {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const path = join(
    ARTIFACT_DIR,
    `weave-qwen-calendar-readonly-${evidence.scenario}-${new Date().toISOString().replace(/[:.]/g, "")}.json`,
  );
  await writeFile(path, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  return path;
}

function toolResultPreviews(evidence: WeaveChatToolCallHarnessEvidence): string[] {
  return evidence.rounds
    .filter((round) => round.kind === "tool_result" && round.toolName === "calendar.search_events")
    .map((round) => round.resultPreview);
}

function assertCommonReadOnlyEvidence(evidence: WeaveChatToolCallHarnessEvidence): void {
  expect(evidence.toolInventory.map((tool) => tool.toolName)).toContain("calendar.search_events");
  expect(evidence.toolInventory.some((tool) => tool.toolName === "calendar.create_event")).toBe(
    false,
  );
  expect(evidence.calendarCreateEventAbsent).toBe(true);
  expect(
    evidence.rounds.some(
      (round) =>
        round.kind === "model_tool_request" &&
        round.requestedTools.some((tool) => tool.toolName === "calendar.search_events"),
    ),
  ).toBe(true);
  expect(toolResultPreviews(evidence).length).toBeGreaterThan(0);
  expect(evidence.rounds.at(-1)).toMatchObject({ kind: "final_answer" });
  expect(evidence.finalText.trim().length).toBeGreaterThan(0);
}

describeLive("weave chat tool-call harness (live)", () => {
  it(
    "proves read-only calendar search evidence for empty and seeded backend states through the real Weave MCP server",
    async () => {
      if (!MCP_URL) {
        throw new Error(
          "OPENCLAW_LIVE_QWEN_TOOLCALL_MCP_URL must point at a real weave-domain-tools server; the live gate must not fall back to an in-process fixture.",
        );
      }

      const emptyEvidence = await runWeaveChatToolCallHarness(createGeneratedConfig(MCP_URL), {
        baseUrl: LMSTUDIO_BASE_URL,
        modelRef: MODEL_REF,
        prompt:
          "Use exactly the read-only calendar.search_events tool for the closed range 1999-01-01T00:00:00Z to 1999-01-02T00:00:00Z. Then answer briefly in German. If the tool result has zero items, say that no events were found.",
        timeoutMs: LIVE_TIMEOUT_MS,
        maxTokens: 160,
        sessionId: "weave-chat-tool-call-live-empty",
        forceFirstToolCall: true,
        forcedFirstToolArguments: {
          from: "1999-01-01T00:00:00Z",
          to: "1999-01-02T00:00:00Z",
        },
      });
      assertCommonReadOnlyEvidence(emptyEvidence);
      const emptyPreviews = toolResultPreviews(emptyEvidence).join("\n");
      expect(emptyPreviews).toMatch(/"items"\s*:\s*\[\s*\]/);
      expect(emptyEvidence.finalText.toLowerCase()).toMatch(
        /kein|keine|keinen|no events|no calendar events/,
      );
      const emptyPath = await writeEvidenceArtifact({
        ...emptyEvidence,
        scenario: "empty",
      });

      const seededEvidence = await runWeaveChatToolCallHarness(createGeneratedConfig(MCP_URL), {
        baseUrl: LMSTUDIO_BASE_URL,
        modelRef: MODEL_REF,
        prompt: `Use exactly the read-only calendar.search_events tool for the range ${SEED_TIME} to ${SEED_TIME}. Then answer briefly in German and mention the stable event facts if present: ${SEED_TITLE}, ${SEED_TIME}, ${SEED_REF_FRAGMENT}.`,
        timeoutMs: LIVE_TIMEOUT_MS,
        maxTokens: 180,
        sessionId: "weave-chat-tool-call-live-seeded",
        forceFirstToolCall: true,
        forcedFirstToolArguments: { from: SEED_TIME, to: SEED_TIME },
      });
      assertCommonReadOnlyEvidence(seededEvidence);
      const seededPreviews = toolResultPreviews(seededEvidence).join("\n");
      expect(seededPreviews).toContain(SEED_TITLE);
      expect(seededPreviews).toContain(SEED_TIME);
      expect(seededPreviews).toContain(SEED_REF_FRAGMENT);
      expect(seededEvidence.finalText).toContain(SEED_TITLE);
      expect(seededEvidence.finalText).toContain(SEED_TIME);
      const seededPath = await writeEvidenceArtifact({
        ...seededEvidence,
        scenario: "seeded",
      });

      expect(emptyPath).toContain("empty");
      expect(seededPath).toContain("seeded");
    },
    LIVE_TIMEOUT_MS * 2 + 60_000,
  );
});
