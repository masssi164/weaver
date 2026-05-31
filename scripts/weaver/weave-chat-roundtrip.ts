#!/usr/bin/env node
import {
  DEFAULT_LMSTUDIO_CONTAINER_BASE_URL,
  DEFAULT_LMSTUDIO_MODEL_REF,
  resolveWeaveChatRoundTripMode,
  runWeaveChatRoundTripHarness,
} from "../../src/weaver/weave-chat-roundtrip-harness.js";

const evidence = await runWeaveChatRoundTripHarness({
  mode: resolveWeaveChatRoundTripMode(),
  lmStudioBaseUrl: process.env.WEAVER_LMSTUDIO_BASE_URL ?? DEFAULT_LMSTUDIO_CONTAINER_BASE_URL,
  modelRef: process.env.WEAVER_LMSTUDIO_MODEL ?? DEFAULT_LMSTUDIO_MODEL_REF,
});

console.log(JSON.stringify(evidence, null, 2));
