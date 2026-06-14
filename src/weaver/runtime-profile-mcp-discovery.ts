import {
  getOrCreateSessionMcpRuntime,
  type SessionMcpRuntime,
} from "../agents/agent-bundle-mcp-tools.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  loadSignedWeaverRuntimeProfile,
  type GeneratedWeaverConfig,
  type SignedWeaverRuntimeProfile,
} from "./runtime-profile.js";

export const WEAVE_DOMAIN_TOOLS_SERVER_NAME = "weave-domain-tools";

export type RuntimeProfileMcpDiscoveryStatus =
  | "discovered"
  | "missing_profile"
  | "profile_revoked"
  | "profile_invalid"
  | "missing_weave_mcp_server"
  | "discovery_failed";

export type RuntimeProfileMcpDiscoveryEvidence = {
  schemaVersion: 1;
  runtimeProfileHash?: string;
  runtimeProfileVersion?: number;
  serverName: typeof WEAVE_DOMAIN_TOOLS_SERVER_NAME;
  supportSafeStatus: RuntimeProfileMcpDiscoveryStatus;
  discoveredServers: string[];
  discoveredTools: Array<{ serverName: string; toolName: string }>;
  diagnostics: string[];
  channelTransportUsed: false;
  chatMessagesSent: 0;
};

export type RuntimeProfileMcpDiscoveryOptions = {
  sessionId?: string;
  sessionKey?: string;
  workspaceDir?: string;
  now?: Date;
  trustedPublicKeyPem?: string;
  getSessionMcpRuntime?: typeof getOrCreateSessionMcpRuntime;
};

export async function verifySignedRuntimeProfileMcpDiscovery(
  profile: SignedWeaverRuntimeProfile | null | undefined,
  options: RuntimeProfileMcpDiscoveryOptions = {},
): Promise<RuntimeProfileMcpDiscoveryEvidence> {
  if (!profile) {
    return buildMcpDiscoveryEvidence({ supportSafeStatus: "missing_profile" });
  }
  try {
    const config = loadSignedWeaverRuntimeProfile(profile, {
      now: options.now,
      trustedPublicKeyPem: options.trustedPublicKeyPem,
    });
    return await discoverGeneratedWeaverMcpTools(config, options);
  } catch (error) {
    return buildMcpDiscoveryEvidence({
      supportSafeStatus: isRevokedProfileError(error) ? "profile_revoked" : "profile_invalid",
      diagnostics: [toSupportSafeDiagnostic(error)],
    });
  }
}

export async function discoverGeneratedWeaverMcpTools(
  config: GeneratedWeaverConfig,
  options: RuntimeProfileMcpDiscoveryOptions = {},
): Promise<RuntimeProfileMcpDiscoveryEvidence> {
  const server = config.mcp.servers[WEAVE_DOMAIN_TOOLS_SERVER_NAME];
  if (!server || server.enabled === false) {
    return buildMcpDiscoveryEvidence({
      config,
      supportSafeStatus: "missing_weave_mcp_server",
      diagnostics: [
        `${WEAVE_DOMAIN_TOOLS_SERVER_NAME} is not enabled in RuntimeProfile MCP config.`,
      ],
    });
  }

  let runtime: SessionMcpRuntime | undefined;
  try {
    runtime = await (options.getSessionMcpRuntime ?? getOrCreateSessionMcpRuntime)({
      sessionId: options.sessionId ?? `runtime-profile-mcp-${config.runtimeProfileHash}`,
      sessionKey: options.sessionKey,
      workspaceDir: options.workspaceDir ?? process.cwd(),
      cfg: { mcp: config.mcp } as OpenClawConfig,
    });
    const catalog = await runtime.getCatalog();
    return buildMcpDiscoveryEvidence({
      config,
      supportSafeStatus: "discovered",
      discoveredServers: Object.keys(catalog.servers).toSorted(),
      discoveredTools: catalog.tools
        .map((tool) => ({ serverName: tool.serverName, toolName: tool.toolName }))
        .toSorted(
          (left, right) =>
            left.serverName.localeCompare(right.serverName) ||
            left.toolName.localeCompare(right.toolName),
        ),
      diagnostics: (catalog.diagnostics ?? []).map((entry) => entry.message),
    });
  } catch (error) {
    return buildMcpDiscoveryEvidence({
      config,
      supportSafeStatus: "discovery_failed",
      diagnostics: [toSupportSafeDiagnostic(error)],
    });
  } finally {
    await runtime?.dispose();
  }
}

function buildMcpDiscoveryEvidence(params: {
  config?: GeneratedWeaverConfig;
  supportSafeStatus: RuntimeProfileMcpDiscoveryStatus;
  discoveredServers?: string[];
  discoveredTools?: Array<{ serverName: string; toolName: string }>;
  diagnostics?: string[];
}): RuntimeProfileMcpDiscoveryEvidence {
  return {
    schemaVersion: 1,
    runtimeProfileHash: params.config?.runtimeProfileHash,
    runtimeProfileVersion: params.config?.runtimeProfileVersion,
    serverName: WEAVE_DOMAIN_TOOLS_SERVER_NAME,
    supportSafeStatus: params.supportSafeStatus,
    discoveredServers: params.discoveredServers ?? [],
    discoveredTools: params.discoveredTools ?? [],
    diagnostics: params.diagnostics ?? [],
    channelTransportUsed: false,
    chatMessagesSent: 0,
  };
}

function isRevokedProfileError(error: unknown): boolean {
  return error instanceof Error && /RuntimeProfile revoked/i.test(error.message);
}

function toSupportSafeDiagnostic(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
