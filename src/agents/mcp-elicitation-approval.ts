import { createHash } from "node:crypto";
import type {
  ElicitRequest,
  ElicitRequestFormParams,
  ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { logWarn } from "../logger.js";
import { createCorePluginStateKeyedStore } from "../plugin-state/plugin-state-store.js";
import { callGatewayTool } from "./tools/gateway.js";

export type McpApprovalContext = {
  toolCallId?: string;
  agentId?: string;
  sessionKey?: string;
  turnSourceChannel?: string;
  turnSourceTo?: string;
  turnSourceAccountId?: string;
  turnSourceThreadId?: string | number;
};

type ApprovalDecision = "allow-once" | "allow-always" | "deny";
type PermissionMode = "deny" | "allowlist" | "ask" | "auto" | "full";

const APPROVAL_TIMEOUT_MS = 120_000;
const REMEMBERED_GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const WEAVE_MCP_SERVER = "weave-domain-tools";
const MCP_TOOL_APPROVAL_KIND = "mcp_tool_call";
const rememberedGrants = createCorePluginStateKeyedStore<RememberedMcpGrant>({
  ownerId: "core:weave-mcp-approval",
  namespace: "grants",
  maxEntries: 2_048,
  defaultTtlMs: REMEMBERED_GRANT_TTL_MS,
});

type RememberedMcpGrant = {
  runtimeProfileHash: string;
  userRuntimeId: string;
  serverName: string;
  toolName: string;
  canonicalScope: string;
};

export async function handleMcpElicitation(params: {
  request: ElicitRequest;
  serverName: string;
  cfg?: OpenClawConfig;
  context?: McpApprovalContext;
  signal?: AbortSignal;
}): Promise<ElicitResult> {
  const request = params.request.params;
  if (request.mode === "url") {
    return { action: "decline" };
  }
  const meta = recordValue(request["_meta"]);
  if (stringValue(meta.codex_approval_kind) !== MCP_TOOL_APPROVAL_KIND) {
    return { action: "decline" };
  }

  const permissionMode = resolvePermissionMode(params.cfg);
  const grant = approvalGrant({
    cfg: params.cfg,
    serverName: params.serverName,
    toolName: stringValue(meta.tool_name) || stringValue(meta.tool_title) || "unknown-tool",
    canonicalScope: stringValue(meta.canonical_scope) || "default",
  });
  const grantKey = approvalGrantKey(grant);

  if (permissionMode === "deny") {
    return { action: "decline" };
  }
  if (permissionMode === "allowlist") {
    return (await hasRememberedGrant(grantKey))
      ? acceptedResult(request.requestedSchema, "allow-always")
      : { action: "decline" };
  }
  if (permissionMode === "full" && isTrustedWeaveMcpBinding(params.cfg, params.serverName)) {
    return acceptedResult(request.requestedSchema, "allow-always");
  }

  const decision = await requestPluginApproval({
    title: boundedText(
      stringValue(meta.tool_title) || `Approve ${stringValue(meta.tool_name) || "Weave action"}`,
      80,
    ),
    description: boundedText(stringValue(meta.tool_description) || request.message, 256),
    toolName: stringValue(meta.tool_name) || "weave_mcp_tool",
    context: params.context,
    signal: params.signal,
  });
  if (decision === "allow-always") {
    const persisted = await rememberGrant(grantKey, grant);
    return acceptedResult(request.requestedSchema, persisted ? "allow-always" : "allow-once");
  }
  return decision === "deny"
    ? { action: "decline" }
    : acceptedResult(request.requestedSchema, decision);
}

function resolvePermissionMode(cfg?: OpenClawConfig): PermissionMode {
  const mode = cfg?.tools?.exec?.mode;
  return mode === "deny" ||
    mode === "allowlist" ||
    mode === "ask" ||
    mode === "auto" ||
    mode === "full"
    ? mode
    : "ask";
}

function isTrustedWeaveMcpBinding(cfg: OpenClawConfig | undefined, serverName: string): boolean {
  if (serverName !== WEAVE_MCP_SERVER) {
    return false;
  }
  const generated = recordValue(cfg?.weaver);
  return (
    generated.generatedBy === "weaver-runtime-profile" &&
    /^sha256:[a-f0-9]{64}$/.test(stringValue(generated.runtimeProfileHash)) &&
    arrayValue(generated.trustedMcpServers).includes(serverName)
  );
}

function approvalGrantKey(grant: RememberedMcpGrant): string {
  return createHash("sha256").update(JSON.stringify(grant)).digest("hex");
}

function approvalGrant(params: {
  cfg?: OpenClawConfig;
  serverName: string;
  toolName: string;
  canonicalScope: string;
}): RememberedMcpGrant {
  const generated = recordValue(params.cfg);
  const weaver = recordValue(generated.weaver);
  return {
    runtimeProfileHash: stringValue(weaver.runtimeProfileHash) || "unsigned-profile",
    userRuntimeId: stringValue(weaver.userRuntimeId) || "unknown-runtime",
    serverName: params.serverName,
    toolName: params.toolName,
    canonicalScope: params.canonicalScope,
  };
}

async function hasRememberedGrant(key: string): Promise<boolean> {
  try {
    return (await rememberedGrants.lookup(key)) !== undefined;
  } catch (error) {
    logWarn(`weave-mcp-approval: failed to read remembered grant: ${String(error)}`);
    return false;
  }
}

async function rememberGrant(key: string, grant: RememberedMcpGrant): Promise<boolean> {
  try {
    await rememberedGrants.register(key, grant, {
      ttlMs: REMEMBERED_GRANT_TTL_MS,
    });
    return true;
  } catch (error) {
    logWarn(`weave-mcp-approval: failed to persist allow-always grant: ${String(error)}`);
    return false;
  }
}

async function requestPluginApproval(params: {
  title: string;
  description: string;
  toolName: string;
  context?: McpApprovalContext;
  signal?: AbortSignal;
}): Promise<ApprovalDecision> {
  try {
    const requestResult = await callGatewayTool<{
      id?: string;
      decision?: ApprovalDecision | null;
    }>(
      "plugin.approval.request",
      { timeoutMs: APPROVAL_TIMEOUT_MS + 5_000 },
      {
        pluginId: "weave-mcp-elicitation",
        title: params.title,
        description: params.description,
        severity: "warning",
        allowedDecisions: ["allow-once", "allow-always", "deny"],
        toolName: params.toolName,
        toolCallId: params.context?.toolCallId,
        agentId: params.context?.agentId,
        sessionKey: params.context?.sessionKey,
        turnSourceChannel: params.context?.turnSourceChannel,
        turnSourceTo: params.context?.turnSourceTo,
        turnSourceAccountId: params.context?.turnSourceAccountId,
        turnSourceThreadId: params.context?.turnSourceThreadId,
        timeoutMs: APPROVAL_TIMEOUT_MS,
        twoPhase: true,
      },
      { expectFinal: false },
    );
    if (!requestResult?.id || requestResult.decision === null) {
      return "deny";
    }
    if (requestResult.decision) {
      return requestResult.decision;
    }
    const wait = callGatewayTool<{ decision?: ApprovalDecision | null }>(
      "plugin.approval.waitDecision",
      { timeoutMs: APPROVAL_TIMEOUT_MS + 5_000 },
      { id: requestResult.id },
    );
    const result = params.signal
      ? await Promise.race([wait, rejectOnAbort(params.signal)])
      : await wait;
    return result?.decision ?? "deny";
  } catch {
    return "deny";
  }
}

function acceptedResult(
  schema: ElicitRequestFormParams["requestedSchema"],
  decision: Exclude<ApprovalDecision, "deny">,
): ElicitResult {
  const properties = recordValue(schema.properties);
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const [name, rawDefinition] of Object.entries(properties)) {
    const definition = recordValue(rawDefinition);
    if (definition.type === "boolean") {
      content[name] = isRememberField(name) ? decision === "allow-always" : true;
    } else if (definition.type === "string") {
      content[name] = isRememberField(name) ? decision : "approved";
    }
  }
  return {
    action: "accept",
    content,
    _meta: { openclaw_approval_decision: decision },
  };
}

function isRememberField(name: string): boolean {
  return /remember|persist|always/i.test(name);
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

function boundedText(value: string, maxLength: number): string {
  const supportSafe = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
  }).join("");
  const normalized = supportSafe.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function arrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export const testing = {
  clearRememberedGrants: () => rememberedGrants.clear(),
};
