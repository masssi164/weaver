import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
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
  };
  const profile = {
    ...hashable,
    runtimeProfileHash: runtimeProfileHash(hashable),
    ...overrides,
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
    const profileWithMatrixChannel = {
      ...envelope,
      profile: {
        ...envelope.profile,
        channels: {
          ...envelope.profile.channels,
          matrix: { homeserver: "https://matrix.example.org" },
        },
      },
    };

    expect(() => loadSignedWeaverRuntimeProfile(profileWithMatrixChannel, { now })).toThrow();
  });
});
