import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createSessionMcpRuntime } from "../../src/agents/agent-bundle-mcp-runtime.js";
import {
  operatorMcpOAuthIdentity,
  requesterMcpOAuthIdentity,
} from "../../src/agents/mcp-oauth-identity.js";

function proofInput(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the live Weaver MCP proof`);
  }
  return value;
}

async function proofWorkloadToken(): Promise<string> {
  const path = proofInput("WEAVER_MCP_PROOF_TOKEN_FILE");
  if (!isAbsolute(path)) {
    throw new Error("WEAVER_MCP_PROOF_TOKEN_FILE must be an absolute path");
  }
  const details = await lstat(path);
  if (!details.isFile() || (details.mode & 0o077) !== 0) {
    throw new Error("WEAVER_MCP_PROOF_TOKEN_FILE must be a regular owner-only file");
  }
  const token = (await readFile(path, "utf8")).trim();
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("WEAVER_MCP_PROOF_TOKEN_FILE must contain one JWT access token");
  }
  return token;
}

function proofMatches(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.matches) ? record.matches : proofMatches(record.result);
}

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
    const otherAgent = requesterMcpOAuthIdentity(serverName, serverUrl, {
      ...alice,
      agentAccountId: "other",
    });
    expect(otherAgent.storeKey).not.toBe(aliceFirstSession.storeKey);
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

  it.skipIf(process.env.WEAVER_MCP_LIVE_PROOF !== "1")(
    "uses the live Weave MCP Files resource and Calendar agenda through OpenClaw",
    async () => {
      const url = URL.parse(proofInput("WEAVER_MCP_PROOF_URL"));
      if (
        !url ||
        url.pathname !== "/mcp" ||
        url.search ||
        url.hash ||
        url.username ||
        url.password ||
        (url.protocol !== "https:" &&
          !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
      ) {
        throw new Error("WEAVER_MCP_PROOF_URL must be HTTPS /mcp or loopback HTTP /mcp");
      }
      const query = proofInput("WEAVER_MCP_PROOF_FILE_QUERY");
      const expectedId = proofInput("WEAVER_MCP_PROOF_EXPECTED_FILE_ID");
      const expectedName = proofInput("WEAVER_MCP_PROOF_EXPECTED_FILE_NAME");
      const expectedContent = proofInput("WEAVER_MCP_PROOF_EXPECTED_FILE_CONTENT");
      const calendarId = proofInput("WEAVER_MCP_PROOF_CALENDAR_ID");
      const eventId = proofInput("WEAVER_MCP_PROOF_EVENT_ID");
      const eventTitle = proofInput("WEAVER_MCP_PROOF_EVENT_TITLE");
      const token = await proofWorkloadToken();
      const workspaceDir = await mkdtemp(join(tmpdir(), "weaver-live-mcp-"));
      try {
        const runtime = createSessionMcpRuntime({
          sessionId: `weaver-live-${randomUUID()}`,
          workspaceDir,
          manifestRegistry: { plugins: [] },
          cfg: {
            plugins: { enabled: false },
            mcp: {
              servers: {
                weave: {
                  url: url.href,
                  transport: "streamable-http",
                  headers: { Authorization: `Bearer ${token}` },
                },
              },
            },
          },
        });
        try {
          const catalog = await runtime.getCatalog();
          expect(catalog.tools.map((tool) => tool.toolName)).toEqual(
            expect.arrayContaining(["files.search", "calendar.agenda"]),
          );
          const result = await runtime.callTool("weave", "files.search", { query, limit: 10 });
          expect(result.isError).not.toBe(true);
          const payloads: unknown[] = [result.structuredContent];
          for (const part of result.content) {
            if (part.type === "text") {
              try {
                payloads.push(JSON.parse(part.text) as unknown);
              } catch {
                // Non-JSON text is not a Files search result.
              }
            }
          }
          const matches = payloads.flatMap(proofMatches);
          const match = matches.find(
            (item) => (item as Record<string, unknown> | null)?.canonicalFileId === expectedId,
          ) as Record<string, unknown> | undefined;
          expect(match).toMatchObject({ canonicalFileId: expectedId, name: expectedName });
          const uri = match?.resourceUri;
          expect(uri).toBeTypeOf("string");
          expect(await runtime.readResource("weave", uri as string)).toMatchObject({
            contents: [expect.objectContaining({ uri, text: expectedContent })],
          });
          const agenda = await runtime.callTool("weave", "calendar.agenda", {
            calendarId,
            from: "2026-10-23T00:00:00Z",
            to: "2026-10-29T00:00:00Z",
            evaluationTimeZone: "Europe/Berlin",
          });
          expect(agenda.isError).not.toBe(true);
          const calendarResult = JSON.stringify(agenda.structuredContent ?? agenda.content);
          for (const expected of [calendarId, eventId, eventTitle]) {
            expect(calendarResult).toContain(expected);
          }
        } finally {
          await runtime.dispose();
        }
      } finally {
        await rm(workspaceDir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
