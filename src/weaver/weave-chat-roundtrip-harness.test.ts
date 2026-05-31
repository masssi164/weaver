import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LMSTUDIO_CONTAINER_BASE_URL,
  normalizeLmStudioRequestModel,
  runWeaveChatRoundTripHarness,
} from "./weave-chat-roundtrip-harness.js";

describe("Weaver weave-chat round-trip harness", () => {
  it("produces deterministic offline evidence without provider-native channel config", async () => {
    const evidence = await runWeaveChatRoundTripHarness({ mode: "offline" });

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      mode: "offline",
      channelId: "weave-chat",
      lmStudio: {
        baseUrl: DEFAULT_LMSTUDIO_CONTAINER_BASE_URL,
        containerVisible: true,
        modelRef: "lmstudio/qwen/qwen3.5-9b",
        requestModel: "qwen/qwen3.5-9b",
        liveCall: "skipped_offline",
      },
      inbound: { channelId: "weave-chat" },
      outbound: { channelId: "weave-chat" },
      runtimeProfilePolicy: {
        approvedReplyTool: "allow",
        unsafeExecTool: "deny",
      },
    });
    expect(evidence.outbound.text).toContain("weave-chat");
    expect(JSON.stringify(evidence)).not.toMatch(/channels\.(matrix|slack|msteams)|homeserver/i);
  });

  it("uses the container-visible LM Studio OpenAI-compatible endpoint in live mode", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async (_input, _init) =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "Live weave-chat round trip ok." } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const evidence = await runWeaveChatRoundTripHarness({ mode: "live", fetchImpl });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://lmstudio.home.internal/v1/chat/completions");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "qwen/qwen3.5-9b",
      stream: false,
    });
    expect(evidence.lmStudio.liveCall).toBe("completed");
    expect(evidence.modelResponse.source).toBe("lmstudio-openai-compatible");
    expect(evidence.outbound).toMatchObject({
      channelId: "weave-chat",
      text: "Live weave-chat round trip ok.",
    });
  });

  it("rejects localhost LM Studio URLs for live/container evidence", async () => {
    await expect(
      runWeaveChatRoundTripHarness({
        mode: "live",
        lmStudioBaseUrl: "http://localhost:1234/v1",
        fetchImpl: vi.fn<typeof fetch>(),
      }),
    ).rejects.toThrow(/container-visible base URL/);
  });

  it("maps the LM Studio provider alias to the model id sent to the local server", () => {
    expect(normalizeLmStudioRequestModel("lmstudio/qwen/qwen3.5-9b")).toBe("qwen/qwen3.5-9b");
    expect(normalizeLmStudioRequestModel("qwen/qwen3.5-9b")).toBe("qwen/qwen3.5-9b");
  });
});
