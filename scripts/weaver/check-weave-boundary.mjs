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
  "`weave-chat` is implemented here",
  "Those providers are Weave backend `providerRef` values",
]);
requireIncludes("docs/channels/weave-chat.md", [
  "Weaver registers one member-mode chat channel: `weave-chat`.",
  "Provider routing stays in Weave.",
  "Raw provider secrets",
]);
requireIncludes("docs/weaver-runtime-profile.md", [
  "memberConfigLocked: true",
  "provider-native chat channel config are rejected",
  "tools.deny is a hard-deny in member mode",
]);
requireIncludes("extensions/weave-chat/src/weave-chat.contract.test.ts", [
  "declares the stable channel id",
  "keeps providerRefs and provider-native channel config out of member runtime config",
  "Weave Chat runtime API boundary",
]);
requireIncludes("extensions/weave-chat/openclaw.plugin.json", [
  "runtimeProfileHash",
  "runtimeProfileVersion",
  "runtimeTokenRef",
]);
requireNotMatches("extensions/weave-chat/openclaw.plugin.json", [
  /providerRef/i,
  /homeserver/i,
  /slack/i,
  /msteams/i,
  /imessage/i,
  /telegram/i,
]);

if (failures.length > 0) {
  console.error("weave-boundary-check: failed");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
console.log("weave-boundary-check: ok runtime=weaver channel=weave-chat product-policy=weave");
