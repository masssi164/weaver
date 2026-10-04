import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createSessionMcpRuntime } from "../../src/agents/agent-bundle-mcp-runtime.js";
import {
  operatorMcpOAuthIdentity,
  requesterMcpOAuthIdentity,
} from "../../src/agents/mcp-oauth-identity.js";

/** Distribution seam using the real OpenClaw MCP client against an isolated protocol endpoint. */
describe("Weaver MCP client journey", () => {
  it("discovers and invokes a curated Files tool through OpenClaw's session runtime", async () => {
    const server = new McpServer({ name: "weaver-files-proof", version: "1.0.0" });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
    const receivedQueries: string[] = [];
    server.registerTool(
      "files.search",
      {
        description: "Find authorized Files references",
        inputSchema: { query: z.string() },
      },
      async ({ query }) => {
        receivedQueries.push(query);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                matches: [{ canonicalFileRef: "file:stable-reference", name: "Roadmap" }],
              }),
            },
          ],
        };
      },
    );
    await server.connect(transport);
    const httpServer = http.createServer((request, response) => {
      if (request.url !== "/mcp") {
        response.writeHead(404).end();
        return;
      }
      void transport.handleRequest(request, response).catch(() => {
        if (!response.headersSent) {
          response.writeHead(500).end();
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("isolated MCP endpoint did not bind a loopback port");
    }

    const workspaceDir = await mkdtemp(join(tmpdir(), "weaver-mcp-client-"));
    try {
      const runtime = createSessionMcpRuntime({
        sessionId: "weaver-files-proof",
        workspaceDir,
        manifestRegistry: { plugins: [] },
        cfg: {
          plugins: { enabled: false },
          mcp: {
            servers: {
              weave: {
                url: `http://127.0.0.1:${address.port}/mcp`,
                transport: "streamable-http",
              },
            },
          },
        },
      });
      try {
        const catalog = await runtime.getCatalog();
        expect(catalog.tools.map((tool) => [tool.serverName, tool.toolName])).toEqual([
          ["weave", "files.search"],
        ]);
        const result = await runtime.callTool("weave", "files.search", { query: "Roadmap" });
        expect(result.isError).not.toBe(true);
        expect(receivedQueries).toEqual(["Roadmap"]);
        const text = result.content.find((entry) => entry.type === "text")?.text;
        expect(JSON.parse(String(text))).toEqual({
          matches: [{ canonicalFileRef: "file:stable-reference", name: "Roadmap" }],
        });
      } finally {
        await runtime.dispose();
      }
    } finally {
      await server.close();
      httpServer.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("keeps operator and requester OAuth identities separate across sessions", () => {
    const serverName = "weave";
    const serverUrl = "https://api.weave.example/mcp";
    const alice = {
      requesterSenderId: "@alice:matrix.example",
      messageChannel: "matrix",
      agentAccountId: "weaver",
    };
    const bob = { ...alice, requesterSenderId: "@bob:matrix.example" };
    const operator = operatorMcpOAuthIdentity(serverName, serverUrl);
    const aliceFirstSession = requesterMcpOAuthIdentity(serverName, serverUrl, alice);
    const aliceSecondSession = requesterMcpOAuthIdentity(serverName, serverUrl, alice);
    const bobSession = requesterMcpOAuthIdentity(serverName, serverUrl, bob);

    expect(operator.principal).toBe("operator");
    expect(aliceFirstSession.principal).toBe("requester");
    expect(aliceFirstSession.storeKey).toBe(aliceSecondSession.storeKey);
    expect(aliceFirstSession.storeKey).not.toBe(bobSession.storeKey);
    expect(aliceFirstSession.storeKey).not.toBe(operator.storeKey);
    expect(
      requesterMcpOAuthIdentity(serverName, serverUrl, { ...alice, agentAccountId: "other" })
        .storeKey,
    ).not.toBe(aliceFirstSession.storeKey);
  });

  it("does not expose requester OAuth tools through an operator session", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "weaver-mcp-requester-"));
    const runtime = createSessionMcpRuntime({
      sessionId: "weaver-operator-proof",
      workspaceDir,
      manifestRegistry: { plugins: [] },
      cfg: {
        plugins: { enabled: false },
        mcp: {
          servers: {
            weave: {
              url: "http://127.0.0.1:1/mcp",
              transport: "streamable-http",
              auth: "oauth",
              oauth: { identity: "per-requester" },
            },
          },
        },
      },
    });
    try {
      expect((await runtime.getCatalog()).tools).toEqual([]);
      await expect(
        runtime.callTool("weave", "files.search", { query: "Roadmap" }),
      ).rejects.toThrow();
    } finally {
      await runtime.dispose();
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
