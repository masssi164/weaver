import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";
import { z } from "zod";

const CredentialRefSchema = z
  .object({
    source: z.string().min(1),
    id: z.string().min(1),
  })
  .strict();

const WeaveChatAccountConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    apiUrl: z.string().url().optional(),
    runtimeProfileHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    runtimeProfileVersion: z.number().int().positive().optional(),
    userRuntimeId: z.string().min(1).optional(),
    runtimeTokenRef: CredentialRefSchema.optional(),
    runtimeTokenCredentialRef: CredentialRefSchema.optional(),
    webhookPath: z.string().startsWith("/").optional(),
    eventStreamPath: z.string().startsWith("/").optional(),
    defaultTo: z.string().optional(),
  })
  .strict();

const WeaveChatConfigSchema = WeaveChatAccountConfigSchema.extend({
  accounts: z.record(z.string(), WeaveChatAccountConfigSchema.partial()).optional(),
  defaultAccount: z.string().optional(),
}).strict();

export const weaveChatPluginConfigSchema = buildChannelConfigSchema(WeaveChatConfigSchema);
