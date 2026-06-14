import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { SessionMcpRuntime } from "../agents/agent-bundle-mcp-types.js";
import {
  discoverGeneratedWeaverMcpTools,
  verifySignedRuntimeProfileMcpDiscovery,
  WEAVE_DOMAIN_TOOLS_SERVER_NAME,
} from "./runtime-profile-mcp-discovery.js";
import {
  loadSignedWeaverRuntimeProfile,
  runtimeProfileHash,
  runtimeProfileSigningPayload,
  type SignedWeaverRuntimeProfile,
  type WeaverRuntimeProfile,
} from "./runtime-profile.js";

const now = new Date("2026-05-31T12:00:00.000Z");

function buildEnvelope(overrides: Partial<WeaverRuntimeProfile> = {}): SignedWeaverRuntimeProfile {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const profileDraft = {
    kind: "WeaverRuntimeProfile" as const,
    profileVersion: 7,
    issuedAt: "2026-05-31T11:00:00.000Z",
    expiresAt: "2026-05-31T13:00:00.000Z",
    user: { id: "user-1", domain: "example.org" },
    models: {
      aliases: { fast: "weave/model-fast" },
      default: "fast",
      fallbacks: ["weave/model-safe"],
    },
    channels: {
      "weave-chat": {
        apiUrl: "https://weave.example.org",
        userRuntimeId: "runtime-user-1",
        runtimeTokenRef: { source: "runtime-token", id: "chat-token" },
      },
    },
    mcp: {
      servers: {
        [WEAVE_DOMAIN_TOOLS_SERVER_NAME]: {
          transport: "streamable-http",
          url: "https://weave.example.org/runtime/mcp",
          auth: "oauth" as const,
          headers: { "x-weave-user-runtime-id": "runtime-user-1" },
        },
      },
    },
    mcpPolicy: {
      allowBundleMcp: false,
      allowedPersonalConnections: [WEAVE_DOMAIN_TOOLS_SERVER_NAME],
    },
    skills: { allow: [], deny: [] },
    tools: { allow: ["message.send"], deny: ["exec"] },
    sandbox: {},
    audit: { mode: "required" as const },
    credentialRefs: {},
    operatorSupport: { enabled: false },
  };
  const merged = { ...profileDraft, ...overrides };
  const profile = {
    ...merged,
    runtimeProfileHash: overrides.runtimeProfileHash ?? runtimeProfileHash(merged),
  };
  const signature = sign(null, runtimeProfileSigningPayload(profile), privateKey).toString(
    "base64",
  );
  return {
    profile,
    signature: {
      alg: "ed25519",
      publicKeyPem,
      value: signature,
    },
  };
}

function createRuntimeMock(): SessionMcpRuntime {
  return {
    sessionId: "runtime-profile-mcp-test",
    workspaceDir: "/tmp/runtime-profile-mcp-test",
    configFingerprint: "fingerprint",
    createdAt: 0,
    lastUsedAt: 0,
    getCatalog: vi.fn(async () => ({
      servers: {
        [WEAVE_DOMAIN_TOOLS_SERVER_NAME]: {
          serverName: WEAVE_DOMAIN_TOOLS_SERVER_NAME,
          safeServerName: WEAVE_DOMAIN_TOOLS_SERVER_NAME,
          connected: true,
          launchSummary: "oauth ok",
          tools: [
            {
              serverName: WEAVE_DOMAIN_TOOLS_SERVER_NAME,
              safeServerName: WEAVE_DOMAIN_TOOLS_SERVER_NAME,
              toolName: "weave.calendar.list",
              safeToolName: "weave.calendar.list",
              description: "List calendar entries",
              inputSchema: { type: "object" },
            },
          ],
        },
      },
      tools: [
        {
          serverName: WEAVE_DOMAIN_TOOLS_SERVER_NAME,
          safeServerName: WEAVE_DOMAIN_TOOLS_SERVER_NAME,
          toolName: "weave.calendar.list",
          safeToolName: "weave.calendar.list",
          description: "List calendar entries",
          inputSchema: { type: "object" },
        },
      ],
      diagnostics: [
        {
          serverName: WEAVE_DOMAIN_TOOLS_SERVER_NAME,
          safeServerName: WEAVE_DOMAIN_TOOLS_SERVER_NAME,
          launchSummary: "oauth ok",
          message: "RuntimeProfile MCP discovery connected successfully.",
        },
      ],
    })),
    peekCatalog: vi.fn(() => null),
    markUsed: vi.fn(),
    callTool: vi.fn(async () => ({ content: [] })),
    dispose: vi.fn(async () => undefined),
  };
}

describe("RuntimeProfile MCP discovery", () => {
  it("discovers Weave MCP tools from RuntimeProfile without using channel transport", async () => {
    const generated = loadSignedWeaverRuntimeProfile(buildEnvelope(), { now });
    const runtime = createRuntimeMock();
    const getSessionMcpRuntime = vi.fn(async ({ cfg }) => {
      expect(cfg).toEqual({ mcp: generated.mcp });
      return runtime;
    });

    const evidence = await discoverGeneratedWeaverMcpTools(generated, {
      getSessionMcpRuntime,
      workspaceDir: "/tmp/runtime-profile-mcp-test",
    });

    expect(getSessionMcpRuntime).toHaveBeenCalledOnce();
    expect(evidence).toMatchObject({
      supportSafeStatus: "discovered",
      serverName: WEAVE_DOMAIN_TOOLS_SERVER_NAME,
      discoveredServers: [WEAVE_DOMAIN_TOOLS_SERVER_NAME],
      discoveredTools: [
        {
          serverName: WEAVE_DOMAIN_TOOLS_SERVER_NAME,
          toolName: "weave.calendar.list",
        },
      ],
      channelTransportUsed: false,
      chatMessagesSent: 0,
    });
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it("fails closed for missing or revoked RuntimeProfiles with support-safe status", async () => {
    await expect(verifySignedRuntimeProfileMcpDiscovery(null, { now })).resolves.toMatchObject({
      supportSafeStatus: "missing_profile",
      channelTransportUsed: false,
      chatMessagesSent: 0,
    });

    const revoked = buildEnvelope({ revoked: true });
    await expect(verifySignedRuntimeProfileMcpDiscovery(revoked, { now })).resolves.toMatchObject({
      supportSafeStatus: "profile_revoked",
      diagnostics: ["Weaver RuntimeProfile revoked"],
      channelTransportUsed: false,
      chatMessagesSent: 0,
    });
  });

  it("does not require MCP for channel-only RuntimeProfiles", async () => {
    const generated = loadSignedWeaverRuntimeProfile(buildEnvelope({ mcp: { servers: {} } }), {
      now,
    });

    const evidence = await discoverGeneratedWeaverMcpTools(generated, {
      getSessionMcpRuntime: vi.fn(),
    });

    expect(evidence).toMatchObject({
      supportSafeStatus: "missing_weave_mcp_server",
      discoveredServers: [],
      discoveredTools: [],
      channelTransportUsed: false,
      chatMessagesSent: 0,
    });
  });
});
