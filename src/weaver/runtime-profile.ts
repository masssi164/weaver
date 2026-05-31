import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { z } from "zod";

const RAW_SECRET_KEY_PATTERN =
  /(secret|password|refresh.?token|oauth.?token|cookie|api.?key|private.?key)/i;
const RAW_SECRET_ALLOWED_KEYS = new Set([
  "credentialRef",
  "credentialRefs",
  "runtimeTokenRef",
  "runtimeTokenCredentialRef",
  "secretRef",
]);
const PROVIDER_CHANNEL_IDS = new Set(["matrix", "msteams", "slack", "imessage", "teams"]);

const CredentialRefSchema = z
  .object({
    source: z.string().min(1),
    id: z.string().min(1),
  })
  .strict();

const RuntimeProfileSignatureSchema = z
  .object({
    alg: z.literal("ed25519"),
    publicKeyPem: z.string().min(1),
    value: z.string().min(1),
  })
  .strict();

const WeaveChatProfileSchema = z
  .object({
    apiUrl: z.string().url(),
    userRuntimeId: z.string().min(1),
    runtimeTokenRef: CredentialRefSchema,
    providerRefs: z.array(z.string().min(1)).optional(),
    webhookPath: z.string().startsWith("/").optional(),
    eventStreamPath: z.string().startsWith("/").optional(),
  })
  .strict();

const RuntimeProfileSchema = z
  .object({
    kind: z.literal("WeaverRuntimeProfile"),
    profileVersion: z.number().int().positive(),
    runtimeProfileHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    revoked: z.boolean().optional(),
    revocation: z
      .object({
        revoked: z.boolean().optional(),
        reason: z.string().optional(),
        checkedAt: z.string().datetime().optional(),
      })
      .strict()
      .optional(),
    user: z
      .object({
        id: z.string().min(1),
        domain: z.string().min(1),
      })
      .strict(),
    models: z
      .object({
        aliases: z.record(z.string(), z.string().min(1)).default({}),
        default: z.string().min(1),
        fallbacks: z.array(z.string().min(1)).default([]),
      })
      .strict(),
    channels: z
      .object({
        "weave-chat": WeaveChatProfileSchema,
      })
      .strict(),
    mcp: z.array(z.record(z.string(), z.unknown())).default([]),
    skills: z
      .object({
        allow: z.array(z.string()).default([]),
        deny: z.array(z.string()).default([]),
      })
      .strict()
      .default({ allow: [], deny: [] }),
    tools: z
      .object({
        allow: z.array(z.string()).default([]),
        deny: z.array(z.string()).default([]),
      })
      .strict()
      .default({ allow: [], deny: [] }),
    sandbox: z.record(z.string(), z.unknown()).default({}),
    audit: z
      .object({
        mode: z.enum(["required", "disabled"]).default("required"),
        exportRef: CredentialRefSchema.optional(),
      })
      .strict()
      .default({ mode: "required" }),
    credentialRefs: z.record(z.string(), CredentialRefSchema).default({}),
  })
  .strict();

const SignedRuntimeProfileSchema = z
  .object({
    profile: RuntimeProfileSchema,
    signature: RuntimeProfileSignatureSchema,
  })
  .strict();

export type WeaverRuntimeProfile = z.infer<typeof RuntimeProfileSchema>;
export type SignedWeaverRuntimeProfile = z.infer<typeof SignedRuntimeProfileSchema>;

export type GeneratedWeaverConfig = {
  generatedBy: "weaver-runtime-profile";
  runtimeProfileHash: string;
  runtimeProfileVersion: number;
  memberConfigLocked: true;
  models: {
    aliases: Record<string, string>;
    default: string;
    fallbacks: string[];
  };
  channels: {
    "weave-chat": {
      apiUrl: string;
      userRuntimeId: string;
      runtimeProfileHash: string;
      runtimeProfileVersion: number;
      runtimeTokenRef: z.infer<typeof CredentialRefSchema>;
      credentialRefs: Record<string, z.infer<typeof CredentialRefSchema>>;
      webhookPath?: string;
      eventStreamPath?: string;
    };
  };
  mcp: Array<Record<string, unknown>>;
  skills: { allow: string[]; deny: string[] };
  tools: { allow: string[]; deny: string[] };
  sandbox: Record<string, unknown>;
  audit: {
    mode: "required" | "disabled";
    runtimeProfileHash: string;
    runtimeProfileVersion: number;
    userId: string;
    domain: string;
    providerRefs: string[];
    credentialRefs: string[];
    exportRef?: z.infer<typeof CredentialRefSchema>;
  };
};

export type RuntimeProfileLifecycleHooks = {
  reload(
    profile: SignedWeaverRuntimeProfile,
  ): Promise<GeneratedWeaverConfig> | GeneratedWeaverConfig;
  restart(reason: { runtimeProfileHash: string; profileVersion: number }): Promise<void> | void;
  rollback(reason: {
    fromRuntimeProfileHash: string;
    toRuntimeProfileHash: string;
    profileVersion: number;
  }): Promise<void> | void;
};

export function createRuntimeProfileLifecycleHooks(params: {
  load: (
    profile: SignedWeaverRuntimeProfile,
  ) => Promise<GeneratedWeaverConfig> | GeneratedWeaverConfig;
  restart?: RuntimeProfileLifecycleHooks["restart"];
  rollback?: RuntimeProfileLifecycleHooks["rollback"];
}): RuntimeProfileLifecycleHooks {
  return {
    reload: params.load,
    restart: params.restart ?? (() => undefined),
    rollback: params.rollback ?? (() => undefined),
  };
}

export function loadSignedWeaverRuntimeProfile(
  input: unknown,
  options: { now?: Date; trustedPublicKeyPem?: string } = {},
): GeneratedWeaverConfig {
  const envelope = SignedRuntimeProfileSchema.parse(input);
  assertNoRawProviderSecrets(envelope.profile);
  assertNoProviderChannelProjection(envelope.profile.channels);
  assertFreshAndUnrevoked(envelope.profile, options.now ?? new Date());
  assertProfileHash(envelope.profile);
  assertProfileSignature(envelope, options.trustedPublicKeyPem);
  return projectRuntimeProfileToConfig(envelope.profile);
}

export function projectRuntimeProfileToConfig(
  profile: WeaverRuntimeProfile,
): GeneratedWeaverConfig {
  const weaveChat = profile.channels["weave-chat"];
  const credentialRefs = profile.credentialRefs;
  return {
    generatedBy: "weaver-runtime-profile",
    runtimeProfileHash: profile.runtimeProfileHash,
    runtimeProfileVersion: profile.profileVersion,
    memberConfigLocked: true,
    models: {
      aliases: { ...profile.models.aliases },
      default: profile.models.default,
      fallbacks: [...profile.models.fallbacks],
    },
    channels: {
      "weave-chat": {
        apiUrl: weaveChat.apiUrl,
        userRuntimeId: weaveChat.userRuntimeId,
        runtimeProfileHash: profile.runtimeProfileHash,
        runtimeProfileVersion: profile.profileVersion,
        runtimeTokenRef: weaveChat.runtimeTokenRef,
        credentialRefs: { ...credentialRefs },
        webhookPath: weaveChat.webhookPath,
        eventStreamPath: weaveChat.eventStreamPath,
      },
    },
    mcp: profile.mcp.map((entry) => ({ ...entry })),
    skills: copyPolicy(profile.skills),
    tools: copyPolicy(profile.tools),
    sandbox: { ...profile.sandbox },
    audit: {
      mode: profile.audit.mode,
      runtimeProfileHash: profile.runtimeProfileHash,
      runtimeProfileVersion: profile.profileVersion,
      userId: profile.user.id,
      domain: profile.user.domain,
      providerRefs: [...(weaveChat.providerRefs ?? [])],
      credentialRefs: Object.keys(credentialRefs).sort(),
      exportRef: profile.audit.exportRef,
    },
  };
}

export function runtimeProfileHash(
  profile: Omit<WeaverRuntimeProfile, "runtimeProfileHash">,
): string {
  return `sha256:${createHash("sha256").update(canonicalJson(profile)).digest("hex")}`;
}

export function runtimeProfileSigningPayload(profile: WeaverRuntimeProfile): Buffer {
  return Buffer.from(canonicalJson(profile));
}

function copyPolicy(policy: { allow: string[]; deny: string[] }) {
  return { allow: [...policy.allow], deny: [...policy.deny] };
}

function assertFreshAndUnrevoked(profile: WeaverRuntimeProfile, now: Date) {
  if (new Date(profile.expiresAt).getTime() <= now.getTime()) {
    throw new Error("Weaver RuntimeProfile expired");
  }
  if (profile.revoked === true || profile.revocation?.revoked === true) {
    throw new Error("Weaver RuntimeProfile revoked");
  }
}

function assertProfileHash(profile: WeaverRuntimeProfile) {
  const { runtimeProfileHash: _hash, ...hashable } = profile;
  const actual = runtimeProfileHash(hashable);
  if (actual !== profile.runtimeProfileHash) {
    throw new Error("Weaver RuntimeProfile hash mismatch");
  }
}

function assertProfileSignature(
  envelope: SignedWeaverRuntimeProfile,
  trustedPublicKeyPem: string | undefined,
) {
  if (
    trustedPublicKeyPem !== undefined &&
    trustedPublicKeyPem !== envelope.signature.publicKeyPem
  ) {
    throw new Error("Weaver RuntimeProfile signed by untrusted key");
  }
  const publicKey = createPublicKey(envelope.signature.publicKeyPem);
  const ok = verifySignature(
    null,
    runtimeProfileSigningPayload(envelope.profile),
    publicKey,
    Buffer.from(envelope.signature.value, "base64"),
  );
  if (!ok) {
    throw new Error("Weaver RuntimeProfile signature verification failed");
  }
}

function assertNoProviderChannelProjection(channels: WeaverRuntimeProfile["channels"]) {
  for (const key of Object.keys(channels)) {
    if (key !== "weave-chat" || PROVIDER_CHANNEL_IDS.has(key)) {
      throw new Error(`RuntimeProfile may only project the weave-chat channel, received ${key}`);
    }
  }
}

function assertNoRawProviderSecrets(value: unknown, path: string[] = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoRawProviderSecrets(entry, [...path, String(index)]));
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (RAW_SECRET_KEY_PATTERN.test(key) && !RAW_SECRET_ALLOWED_KEYS.has(key)) {
      throw new Error(
        `Raw provider secret field is not allowed in RuntimeProfile: ${nextPath.join(".")}`,
      );
    }
    assertNoRawProviderSecrets(nested, nextPath);
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortForJson(value));
}

function sortForJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortForJson(nested)]),
    );
  }
  return value;
}
