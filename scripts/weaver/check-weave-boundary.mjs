#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];
const requireIncludes = (path, needles) => {
  const text = read(path);
  for (const needle of needles) {
    if (!text.includes(needle)) {
      failures.push(`${path} missing ${JSON.stringify(needle)}`);
    }
  }
};
const requireNotMatches = (path, patterns) => {
  const text = read(path);
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      failures.push(`${path} contains forbidden ${pattern}`);
    }
  }
};

requireIncludes("docs/weave-integration-boundary.md", [
  "Weaver owns",
  "Weave owns",
  "OpenClaw's existing Matrix plugin",
  "Weave owns the northbound Matrix-compatible protocol facade",
]);
requireIncludes("docs/channels/weave-chat.md", [
  "The custom `weave-chat` plugin is retired.",
  "`channels.matrix`",
  "There is no compatibility alias.",
]);
requireIncludes("docs/weaver-runtime-profile.md", [
  "memberConfigLocked: true",
  "OpenClaw's stock Matrix plugin",
  "Spring AI MCP tools use MCP form",
  "tools.deny is a hard-deny in member mode",
]);
requireIncludes("src/weaver/runtime-profile.ts", [
  "channels: {",
  "matrix: MatrixNorthboundProfileSchema",
  'params.channelId === "matrix"',
]);
requireNotMatches("src/weaver/runtime-profile.ts", [
  /channels\.weave-chat/,
  /channelId === ["']weave-chat["']/,
]);

if (failures.length > 0) {
  console.error("weave-boundary-check: failed");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
console.log("weave-boundary-check: ok runtime=weaver channel=matrix-facade product-policy=weave");
