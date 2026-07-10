import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ElicitRequest } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resetPluginStateStoreForTests } from "../plugin-state/plugin-state-store.js";
import { handleMcpElicitation, testing } from "./mcp-elicitation-approval.js";
import { callGatewayTool } from "./tools/gateway.js";

vi.mock("./tools/gateway.js", () => ({ callGatewayTool: vi.fn() }));

const mockedCallGatewayTool = vi.mocked(callGatewayTool);
let stateDir: string;

function config(mode: "deny" | "allowlist" | "ask" | "auto" | "full"): OpenClawConfig {
  return {
    weaver: {
      generatedBy: "weaver-runtime-profile",
      runtimeProfileHash: `sha256:${"a".repeat(64)}`,
      runtimeProfileVersion: 1,
      userRuntimeId: "runtime-user-1",
      memberConfigLocked: true,
      permissionMode: mode,
      trustedMcpServers: ["weave-domain-tools"],
    },
    tools: { exec: { mode } },
  } as OpenClawConfig;
}

function request(scope = "calendar:event:create"): ElicitRequest {
  return {
    method: "elicitation/create",
    params: {
      mode: "form",
      message: "Create the calendar event?",
      requestedSchema: {
        type: "object",
        properties: {
          approved: { type: "boolean" },
          remember: { type: "boolean" },
        },
        required: ["approved", "remember"],
      },
      _meta: {
        codex_approval_kind: "mcp_tool_call",
        tool_name: "calendar.create_event",
        tool_title: "Create calendar event",
        tool_description: "Create one event in Team Calendar",
        canonical_scope: scope,
      },
    },
  };
}

describe("MCP elicitation approvals", () => {
  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-weave-mcp-approval-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    mockedCallGatewayTool.mockReset();
    await testing.clearRememberedGrants();
  });

  afterEach(async () => {
    await testing.clearRememberedGrants();
    resetPluginStateStoreForTests();
    vi.unstubAllEnvs();
    await fs.rm(stateDir, { force: true, recursive: true });
  });

  it("fails closed in deny mode without creating a plugin approval", async () => {
    await expect(
      handleMcpElicitation({
        request: request(),
        serverName: "weave-domain-tools",
        cfg: config("deny"),
      }),
    ).resolves.toEqual({ action: "decline" });
    expect(mockedCallGatewayTool).not.toHaveBeenCalled();
  });

  it("routes ask mode through plugin approvals and remembers an exact allow-always grant", async () => {
    mockedCallGatewayTool
      .mockResolvedValueOnce({ id: "plugin:approval-1" })
      .mockResolvedValueOnce({ decision: "allow-always" });

    const accepted = await handleMcpElicitation({
      request: request(),
      serverName: "weave-domain-tools",
      cfg: config("ask"),
      context: {
        toolCallId: "tool-call-1",
        sessionKey: "agent:main:matrix:room:weaver",
        turnSourceChannel: "matrix",
        turnSourceTo: "room:!weaver:api.weave.example.org",
      },
    });

    expect(accepted).toMatchObject({
      action: "accept",
      content: { approved: true, remember: true },
    });
    expect(mockedCallGatewayTool).toHaveBeenNthCalledWith(
      1,
      "plugin.approval.request",
      expect.anything(),
      expect.objectContaining({
        pluginId: "weave-mcp-elicitation",
        allowedDecisions: ["allow-once", "allow-always", "deny"],
        turnSourceChannel: "matrix",
      }),
      { expectFinal: false },
    );

    resetPluginStateStoreForTests();
    mockedCallGatewayTool.mockClear();
    await expect(
      handleMcpElicitation({
        request: request(),
        serverName: "weave-domain-tools",
        cfg: config("allowlist"),
      }),
    ).resolves.toMatchObject({ action: "accept", content: { approved: true, remember: true } });
    expect(mockedCallGatewayTool).not.toHaveBeenCalled();

    await expect(
      handleMcpElicitation({
        request: request("calendar:event:other"),
        serverName: "weave-domain-tools",
        cfg: config("allowlist"),
      }),
    ).resolves.toEqual({ action: "decline" });
  });

  it("auto-accepts full mode only for a signed Weave MCP binding", async () => {
    await expect(
      handleMcpElicitation({
        request: request(),
        serverName: "weave-domain-tools",
        cfg: config("full"),
      }),
    ).resolves.toMatchObject({ action: "accept", content: { approved: true } });
    expect(mockedCallGatewayTool).not.toHaveBeenCalled();

    mockedCallGatewayTool.mockResolvedValueOnce({ decision: null });
    await expect(
      handleMcpElicitation({
        request: request(),
        serverName: "untrusted-server",
        cfg: config("full"),
      }),
    ).resolves.toEqual({ action: "decline" });
    expect(mockedCallGatewayTool).toHaveBeenCalledOnce();
  });

  it("declines ordinary data elicitations instead of treating them as approvals", async () => {
    const ordinary = request();
    ordinary.params["_meta"] = { codex_approval_kind: "collect_user_input" };
    await expect(
      handleMcpElicitation({
        request: ordinary,
        serverName: "weave-domain-tools",
        cfg: config("ask"),
      }),
    ).resolves.toEqual({ action: "decline" });
  });
});
