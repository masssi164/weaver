import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "../config/zod-schema.js";
import {
  decideRuntimeProfileChannelPolicy,
  decideRuntimeProfileMcpPolicy,
  decideRuntimeProfileMemberSurfacePolicy,
  decideRuntimeProfileModelPolicy,
  decideRuntimeProfileToolPolicy,
  exportRuntimeProfileAuditDecision,
  loadSignedWeaverRuntimeProfile,
  runtimeProfileHash,
  runtimeProfileSigningPayload,
  synchronizeWeaverHostExecApprovals,
  type SignedWeaverRuntimeProfile,
  type WeaverRuntimeProfile,
} from "./runtime-profile.js";

const now = new Date("2026-05-31T12:00:00.000Z");

function buildEnvelope(overrides: Partial<WeaverRuntimeProfile> = {}): SignedWeaverRuntimeProfile {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const hashable: Omit<WeaverRuntimeProfile, "runtimeProfileHash"> = {
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
      matrix: {
        homeserver: "https://api.weave.example.org",
        userId: "@weaver:api.weave.example.org",
        memberUserId: "@member:api.weave.example.org",
        roomId: "!weaver:api.weave.example.org",
        userRuntimeId: "runtime-user-1",
        accessTokenRef: {
          source: "env",
          provider: "default",
          id: "WEAVE_MATRIX_ACCESS_TOKEN",
        },
        dangerouslyAllowPrivateNetwork: false,
        providerRefs: ["matrix:room-a", "slack:channel-b"],
      },
    },
    permissionMode: "ask" as const,
    mcp: {
      servers: {
        "weave-domain-tools": {
          url: "https://weave.example.org/runtime/mcp",
          transport: "streamable-http",
          auth: "oauth",
          oauth: {
            scope: "runtime",
            redirectUrl: "https://weave.example.org/runtime/mcp/oauth/callback",
            clientMetadataUrl: "https://weave.example.org/runtime/mcp/oauth/client-metadata",
          },
          headers: { "x-weave-user-runtime-id": "runtime-user-1" },
          toolFilter: { include: ["calendar.*"] },
        },
      },
    },
    mcpPolicy: { allowBundleMcp: false, allowedPersonalConnections: ["weave-domain-tools"] },
    skills: { allow: ["calendar.read"], deny: [] },
    tools: { allow: ["message.send"], deny: ["exec", "write", "apply_patch"] },
    sandbox: { network: "weave-only" },
    audit: {
      mode: "required" as const,
      exportRef: { source: "runtime", id: "audit-sink" },
    },
    credentialRefs: {
      "calendar-runtime": { source: "runtime", id: "calendar" },
    },
    operatorSupport: { enabled: false },
  };
  const profileDraft: Omit<WeaverRuntimeProfile, "runtimeProfileHash"> = {
    ...hashable,
    ...overrides,
  };
  const profile: WeaverRuntimeProfile = {
    ...profileDraft,
    runtimeProfileHash: overrides.runtimeProfileHash ?? runtimeProfileHash(profileDraft),
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

describe("Weaver RuntimeProfile loader", () => {
  it("loads a signed profile into the stock Matrix channel against the Weave facade", () => {
    const envelope = buildEnvelope();

    const generated = loadSignedWeaverRuntimeProfile(envelope, {
      now,
      trustedPublicKeyPem: envelope.signature.publicKeyPem,
    });

    expect(generated.memberConfigLocked).toBe(true);
    expect(OpenClawSchema.safeParse(generated.openClawConfig)).toMatchObject({ success: true });
    expect(generated.models).toEqual({
      aliases: { fast: "weave/model-fast" },
      default: "fast",
      fallbacks: ["weave/model-safe"],
    });
    expect(Object.keys(generated.channels)).toEqual(["matrix"]);
    expect(generated.channels.matrix).toMatchObject({
      homeserver: "https://api.weave.example.org",
      userId: "@weaver:api.weave.example.org",
      accessToken: { source: "env", provider: "default", id: "WEAVE_MATRIX_ACCESS_TOKEN" },
      encryption: false,
      dm: { policy: "allowlist", allowFrom: ["@member:api.weave.example.org"] },
      execApprovals: {
        enabled: true,
        approvers: ["@member:api.weave.example.org"],
        target: "both",
      },
      runtimeProfileHash: envelope.profile.runtimeProfileHash,
      runtimeProfileVersion: 7,
      userRuntimeId: "runtime-user-1",
    });
    expect(JSON.stringify(generated.channels)).not.toContain("slack");
    expect(generated.permissionMode).toBe("ask");
    expect(generated.tools.exec).toEqual({ mode: "ask" });
    expect(generated.audit.providerRefs).toEqual(["matrix:room-a", "slack:channel-b"]);
    expect(generated.mcp).toMatchObject({
      servers: {
        "weave-domain-tools": {
          url: "https://weave.example.org/runtime/mcp",
          transport: "streamable-http",
          auth: "oauth",
          headers: { "x-weave-user-runtime-id": "runtime-user-1" },
        },
      },
    });
    expect(generated.audit.credentialRefs).toEqual(["calendar-runtime"]);
    expect(generated.tools.deny).toEqual(["exec", "write", "apply_patch"]);
    expect(generated.memberMode).toMatchObject({
      rawConfigLocked: true,
      allowedControls: [
        "style",
        "memory",
        "model-alias-selection",
        "allowed-skills",
        "workspace-preferences",
        "personal-mcp-connections",
      ],
      deniedSurfaces: expect.arrayContaining([
        "openclaw.json",
        "raw-config-wizard",
        "raw-dashboard",
        "secrets-admin",
        "tool-allowlists-admin",
      ]),
    });
  });

  it("enforces member-mode tool and MCP policy with support-safe audit metadata", () => {
    const envelope = buildEnvelope({
      tools: { allow: ["write"], deny: ["exec"] },
      mcpPolicy: { allowBundleMcp: false, allowedPersonalConnections: ["weave-domain-tools"] },
    });
    const generated = loadSignedWeaverRuntimeProfile(envelope, {
      now,
      trustedPublicKeyPem: envelope.signature.publicKeyPem,
    });

    expect(
      decideRuntimeProfileMemberSurfacePolicy({ config: generated, surface: "openclaw.json" }),
    ).toMatchObject({
      decision: "deny",
      reason: expect.stringContaining("Raw OpenClaw configuration"),
    });
    expect(
      decideRuntimeProfileMemberSurfacePolicy({ config: generated, surface: "style" }),
    ).toMatchObject({
      decision: "allow",
      reason: "Weave-approved bounded member control",
    });
    expect(decideRuntimeProfileToolPolicy({ config: generated, tool: "exec" })).toMatchObject({
      decision: "deny",
      reason: "RuntimeProfile tools.deny hard-deny",
    });
    expect(decideRuntimeProfileToolPolicy({ config: generated, tool: "write" })).toMatchObject({
      decision: "allow",
      reason: "RuntimeProfile tools.allow exception",
    });
    expect(decideRuntimeProfileToolPolicy({ config: generated, tool: "gateway" })).toMatchObject({
      decision: "deny",
      reason: "member runtime default-deny for unsafe OpenClaw tool",
    });
    const mcpDecision = decideRuntimeProfileMcpPolicy({
      config: generated,
      action: "bundle-mcp",
      providerRef: "matrix:room-a",
      credentialRef: { source: "runtime", id: "calendar" },
    });

    expect(mcpDecision).toMatchObject({
      runtimeProfileHash: envelope.profile.runtimeProfileHash,
      runtimeProfileVersion: 7,
      userRuntimeId: "runtime-user-1",
      userId: "user-1",
      toolOrAction: "bundle-mcp",
      domain: "example.org",
      providerRef: "matrix:room-a",
      credentialRef: { source: "runtime", id: "calendar" },
      decision: "deny",
    });
    expect(JSON.stringify(exportRuntimeProfileAuditDecision(mcpDecision))).not.toMatch(
      /secret|token-value|refresh/i,
    );

    const bundleAllowed = loadSignedWeaverRuntimeProfile(
      buildEnvelope({
        mcpPolicy: { allowBundleMcp: true, allowedPersonalConnections: ["weave-domain-tools"] },
      }),
      { now },
    );
    expect(
      decideRuntimeProfileMcpPolicy({ config: bundleAllowed, action: "bundle-mcp" }).decision,
    ).toBe("allow");
  });

  it("exports support-safe model and channel audit refs for Weaver decisions", () => {
    const envelope = buildEnvelope();
    const generated = loadSignedWeaverRuntimeProfile(envelope, {
      now,
      trustedPublicKeyPem: envelope.signature.publicKeyPem,
    });

    const channelDecision = decideRuntimeProfileChannelPolicy({
      config: generated,
      channelId: "matrix",
      providerRef: "matrix:room-a",
      credentialRef: { source: "runtime-token", id: "chat-token" },
    });
    expect(channelDecision).toMatchObject({
      runtimeProfileHash: envelope.profile.runtimeProfileHash,
      runtimeProfileVersion: 7,
      userRuntimeId: "runtime-user-1",
      userId: "user-1",
      domain: "example.org",
      channelId: "matrix",
      providerRef: "matrix:room-a",
      credentialRef: { source: "runtime-token", id: "chat-token" },
      decision: "allow",
    });

    expect(
      decideRuntimeProfileChannelPolicy({ config: generated, channelId: "slack" }),
    ).toMatchObject({
      channelId: "slack",
      decision: "deny",
      reason: expect.stringContaining("outside the signed Weave northbound projection"),
    });

    const modelDecision = decideRuntimeProfileModelPolicy({
      config: generated,
      channelId: "matrix",
      modelRef: "fast",
      providerRef: "matrix:room-a",
    });
    expect(modelDecision).toMatchObject({
      channelId: "matrix",
      modelRef: "fast",
      providerRef: "matrix:room-a",
      decision: "allow",
    });
    expect(
      decideRuntimeProfileModelPolicy({ config: generated, modelRef: "provider/raw-model" }),
    ).toMatchObject({
      modelRef: "provider/raw-model",
      decision: "deny",
      reason: expect.stringContaining("outside the RuntimeProfile model set"),
    });

    expect(JSON.stringify(exportRuntimeProfileAuditDecision(modelDecision))).toContain(
      '"modelRef":"fast"',
    );
    expect(JSON.stringify(exportRuntimeProfileAuditDecision(channelDecision))).toContain(
      '"channelId":"matrix"',
    );
    expect(JSON.stringify(exportRuntimeProfileAuditDecision(channelDecision))).not.toMatch(
      /secret|token-value|refresh/i,
    );
  });

  it("rejects unsigned, expired, revoked, tampered, or raw-secret-bearing profiles", () => {
    const valid = buildEnvelope();
    expect(() =>
      loadSignedWeaverRuntimeProfile({ ...valid, signature: undefined }, { now }),
    ).toThrow();
    expect(() =>
      loadSignedWeaverRuntimeProfile(buildEnvelope({ expiresAt: "2026-05-31T11:59:00.000Z" }), {
        now,
      }),
    ).toThrow(/expired/);
    expect(() => loadSignedWeaverRuntimeProfile(buildEnvelope({ revoked: true }), { now })).toThrow(
      /revoked/,
    );
    expect(() =>
      loadSignedWeaverRuntimeProfile(
        {
          ...valid,
          profile: { ...valid.profile, profileVersion: 8 },
        },
        { now },
      ),
    ).toThrow(/hash mismatch|signature verification failed/);
    expect(() =>
      loadSignedWeaverRuntimeProfile(
        buildEnvelope({
          mcp: {
            servers: {
              bad: { oauthRefreshToken: "raw-refresh-token" },
            },
          },
        }),
        { now },
      ),
    ).toThrow(/Raw provider secret/);
  });

  it("rejects southbound or custom channel projections before they can enter generated config", () => {
    const envelope = buildEnvelope();
    const providerChannelCases = [
      {
        label: "top-level Slack channel",
        channels: {
          ...envelope.profile.channels,
          slack: { botTokenRef: { source: "runtime", id: "slack" } },
        },
      },
      {
        label: "provider-native config nested inside matrix",
        channels: {
          matrix: {
            ...envelope.profile.channels.matrix,
            slack: { botTokenRef: { source: "runtime", id: "slack" } },
          },
        },
      },
      {
        label: "raw southbound endpoint nested inside matrix",
        channels: {
          matrix: {
            ...envelope.profile.channels.matrix,
            providerHomeserver: "https://matrix.example.org",
          },
        },
      },
    ];

    for (const { label, channels } of providerChannelCases) {
      expect(
        () =>
          loadSignedWeaverRuntimeProfile(
            {
              ...envelope,
              profile: {
                ...envelope.profile,
                channels,
              },
            },
            { now },
          ),
        label,
      ).toThrow();
    }
  });

  it("rejects raw provider credentials even when a Matrix SecretRef is present", () => {
    const envelope = buildEnvelope();

    const profileWithRawProviderCredential = buildEnvelope({
      channels: {
        matrix: {
          ...envelope.profile.channels.matrix,
        },
      },
      credentialRefs: {
        "chat-token": { source: "runtime-token", id: "chat-token" },
      },
      mcp: {
        servers: {
          "matrix-bridge": {
            credentialRef: "chat-token",
            apiKey: "raw-provider-api-key",
          },
        },
      },
    });

    expect(() => loadSignedWeaverRuntimeProfile(profileWithRawProviderCredential, { now })).toThrow(
      /Raw provider secret/,
    );
  });

  it("defaults channel-only RuntimeProfiles to an empty MCP server map", () => {
    const generated = loadSignedWeaverRuntimeProfile(buildEnvelope({ mcp: { servers: {} } }), {
      now,
    });

    expect(generated.channels.matrix.homeserver).toBe("https://api.weave.example.org");
    expect(generated.mcp).toEqual({ servers: {}, sessionIdleTtlMs: undefined });
  });

  it("projects every permission mode into the normalized OpenClaw exec policy", () => {
    for (const permissionMode of ["deny", "allowlist", "ask", "auto", "full"] as const) {
      const generated = loadSignedWeaverRuntimeProfile(buildEnvelope({ permissionMode }), { now });
      expect(generated.permissionMode).toBe(permissionMode);
      expect(generated.tools.exec.mode).toBe(permissionMode);
      expect(generated.openClawConfig.tools?.exec?.mode).toBe(permissionMode);
      expect(generated.hostExecApprovals.defaults).toMatchObject(
        permissionMode === "full"
          ? { security: "full", ask: "off", askFallback: "full" }
          : permissionMode === "deny"
            ? { security: "deny", ask: "off", askFallback: "deny" }
            : { security: "allowlist", askFallback: "deny" },
      );
    }
  });

  it("synchronizes the host approvals layer while preserving allow-always entries", () => {
    const generated = loadSignedWeaverRuntimeProfile(buildEnvelope({ permissionMode: "full" }), {
      now,
    });
    let saved: unknown;

    const next = synchronizeWeaverHostExecApprovals(generated, {
      load: () => ({
        version: 1,
        socket: { path: "/tmp/openclaw.sock", token: "support-safe-test-token" },
        agents: {
          main: {
            security: "allowlist",
            ask: "on-miss",
            allowlist: [{ pattern: "/usr/bin/rg", source: "allow-always" }],
          },
        },
      }),
      save: (file) => {
        saved = file;
      },
    });

    expect(next.defaults).toMatchObject({ security: "full", ask: "off", askFallback: "full" });
    expect(next.agents?.main).toMatchObject({
      security: "full",
      ask: "off",
      askFallback: "full",
      allowlist: [{ pattern: "/usr/bin/rg", source: "allow-always" }],
    });
    expect(next.socket).toEqual({
      path: "/tmp/openclaw.sock",
      token: "support-safe-test-token",
    });
    expect(saved).toEqual(next);
  });
});
