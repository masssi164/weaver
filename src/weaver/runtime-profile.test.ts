import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decideRuntimeProfileMcpPolicy,
  decideRuntimeProfileMemberSurfacePolicy,
  decideRuntimeProfileToolPolicy,
  exportRuntimeProfileAuditDecision,
  loadSignedWeaverRuntimeProfile,
  runtimeProfileHash,
  runtimeProfileSigningPayload,
  type SignedWeaverRuntimeProfile,
  type WeaverRuntimeProfile,
} from "./runtime-profile.js";

const now = new Date("2026-05-31T12:00:00.000Z");

function buildEnvelope(overrides: Partial<WeaverRuntimeProfile> = {}): SignedWeaverRuntimeProfile {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const hashable = {
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
        providerRefs: ["matrix:room-a", "slack:channel-b"],
        webhookPath: "/runtime/weave-chat/webhook",
        eventStreamPath: "/runtime/weave-chat/events",
      },
    },
    mcp: [{ id: "calendar", credentialRef: "calendar-runtime" }],
    mcpPolicy: { allowBundleMcp: false, allowedPersonalConnections: ["calendar"] },
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
  const profileDraft = { ...hashable, ...overrides };
  const profile = {
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
  it("loads a signed profile into generated internal OpenClaw config without provider channel projection", () => {
    const envelope = buildEnvelope();

    const generated = loadSignedWeaverRuntimeProfile(envelope, {
      now,
      trustedPublicKeyPem: envelope.signature.publicKeyPem,
    });

    expect(generated.memberConfigLocked).toBe(true);
    expect(generated.models).toEqual({
      aliases: { fast: "weave/model-fast" },
      default: "fast",
      fallbacks: ["weave/model-safe"],
    });
    expect(Object.keys(generated.channels)).toEqual(["weave-chat"]);
    expect(generated.channels["weave-chat"]).toMatchObject({
      apiUrl: "https://weave.example.org",
      runtimeProfileHash: envelope.profile.runtimeProfileHash,
      runtimeProfileVersion: 7,
      userRuntimeId: "runtime-user-1",
      runtimeTokenRef: { source: "runtime-token", id: "chat-token" },
    });
    expect(JSON.stringify(generated.channels)).not.toContain("matrix");
    expect(JSON.stringify(generated.channels)).not.toContain("slack");
    expect(generated.audit.providerRefs).toEqual(["matrix:room-a", "slack:channel-b"]);
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
      mcpPolicy: { allowBundleMcp: false, allowedPersonalConnections: ["calendar"] },
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
        mcpPolicy: { allowBundleMcp: true, allowedPersonalConnections: ["calendar"] },
      }),
      { now },
    );
    expect(
      decideRuntimeProfileMcpPolicy({ config: bundleAllowed, action: "bundle-mcp" }).decision,
    ).toBe("allow");
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
          mcp: [{ id: "bad", oauthRefreshToken: "raw-refresh-token" }],
        }),
        { now },
      ),
    ).toThrow(/Raw provider secret/);
  });

  it("rejects provider-named channel projections before they can enter generated config", () => {
    const envelope = buildEnvelope();
    const providerChannelCases = [
      {
        label: "top-level Matrix channel",
        channels: {
          ...envelope.profile.channels,
          matrix: { homeserver: "https://matrix.example.org" },
        },
      },
      {
        label: "top-level Slack channel",
        channels: {
          ...envelope.profile.channels,
          slack: { botTokenRef: { source: "runtime", id: "slack" } },
        },
      },
      {
        label: "provider-native config nested inside weave-chat",
        channels: {
          "weave-chat": {
            ...envelope.profile.channels["weave-chat"],
            matrix: { homeserver: "https://matrix.example.org" },
          },
        },
      },
      {
        label: "raw provider endpoint nested inside weave-chat",
        channels: {
          "weave-chat": {
            ...envelope.profile.channels["weave-chat"],
            homeserver: "https://matrix.example.org",
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

  it("rejects raw provider credentials even when they are placed near allowed weave-chat credential refs", () => {
    const envelope = buildEnvelope();

    const profileWithRawProviderCredential = buildEnvelope({
      channels: {
        "weave-chat": {
          ...envelope.profile.channels["weave-chat"],
          runtimeTokenRef: { source: "runtime-token", id: "chat-token" },
        },
      },
      credentialRefs: {
        "chat-token": { source: "runtime-token", id: "chat-token" },
      },
      mcp: [
        {
          id: "matrix-bridge",
          credentialRef: "chat-token",
          apiKey: "raw-provider-api-key",
        },
      ],
    });

    expect(() => loadSignedWeaverRuntimeProfile(profileWithRawProviderCredential, { now })).toThrow(
      /Raw provider secret/,
    );
  });
});
