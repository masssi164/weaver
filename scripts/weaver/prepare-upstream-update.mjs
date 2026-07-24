#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const stableVersionPattern = /^v(?<year>\d{4})\.(?<month>\d{1,2})\.(?<patch>\d{1,3})$/;
const fullCommitPattern = /^[a-f0-9]{40}$/;

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export function parseStableReleaseVersion(value) {
  const match = stableVersionPattern.exec(value ?? "");
  if (!match?.groups) {
    throw new Error(`release ${JSON.stringify(value)} is not in the stable vYYYY.M.P channel`);
  }
  const parts = ["year", "month", "patch"].map((part) => Number(match.groups[part]));
  if (parts.some((part) => !Number.isSafeInteger(part) || part < 0)) {
    throw new Error(`release ${JSON.stringify(value)} has invalid numeric components`);
  }
  return parts;
}

export function compareStableReleaseVersions(left, right) {
  const leftParts = parseStableReleaseVersion(left);
  const rightParts = parseStableReleaseVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return Math.sign(leftParts[index] - rightParts[index]);
    }
  }
  return 0;
}

function releaseDate(value) {
  requireString(value, "release.published_at");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error("release.published_at must be a valid timestamp");
  }
  return parsed.toISOString().slice(0, 10);
}

export function validateReleaseDiscovery({ policy, release, tagRef, tagObject }) {
  requireRecord(policy, "policy");
  const upstream = requireRecord(policy.upstream, "policy.upstream");
  requireRecord(release, "release");
  requireRecord(tagRef, "tagRef");
  requireRecord(tagObject, "tagObject");

  if (release.draft === true || release.prerelease === true) {
    throw new Error("candidate release must be published and non-prerelease");
  }
  const tag = requireString(release.tag_name, "release.tag_name");
  const ordering = compareStableReleaseVersions(tag, upstream.release);
  if (ordering < 0) {
    throw new Error(`candidate ${tag} rolls back the pinned release ${upstream.release}`);
  }
  const expectedReleaseUrl = `${upstream.repository}/releases/tag/${tag}`;
  if (release.html_url !== expectedReleaseUrl) {
    throw new Error(`release URL must be ${expectedReleaseUrl}`);
  }
  if (tagRef.ref !== `refs/tags/${tag}` || tagRef.object?.type !== "tag") {
    throw new Error("candidate must resolve through an annotated tag object");
  }
  if (tagObject.tag !== tag || tagObject.object?.type !== "commit") {
    throw new Error("annotated tag must directly identify the candidate commit");
  }
  const commit = requireString(tagObject.object.sha, "tagObject.object.sha");
  if (!fullCommitPattern.test(commit)) {
    throw new Error("candidate commit must be a full lowercase Git commit");
  }
  if (tagRef.object.sha !== tagObject.sha && tagRef.object.sha !== undefined) {
    throw new Error("tag ref and fetched tag object disagree");
  }
  if (
    tagObject.verification?.verified !== true ||
    tagObject.verification?.reason !== "valid" ||
    typeof tagObject.verification?.signature !== "string"
  ) {
    throw new Error("GitHub did not report a valid signed annotated tag");
  }
  if (policy.upstream.retiredCommits?.includes(commit)) {
    throw new Error(`candidate commit ${commit} is retired`);
  }
  if (ordering === 0 && commit !== upstream.commit) {
    throw new Error(`stable release ${tag} moved from ${upstream.commit} to ${commit}`);
  }
  const publishedDate = releaseDate(release.published_at);
  if (ordering > 0 && publishedDate < upstream.releaseDate) {
    throw new Error("newer release has a publication date older than the pinned release");
  }

  return {
    schemaVersion: 1,
    channel: "stable",
    updateAvailable: ordering > 0,
    release: tag,
    releaseUrl: release.html_url,
    releaseDate: publishedDate,
    tagObject: tagObject.sha ?? tagRef.object.sha,
    commit,
    apiVerification: {
      verified: true,
      reason: "valid",
      verifiedAt: tagObject.verification.verified_at ?? null,
    },
  };
}

export function buildCandidatePolicy(policy, evidence, reviewedAt) {
  const candidate = structuredClone(policy);
  candidate.upstream.release = evidence.release;
  candidate.upstream.commit = evidence.commit;
  candidate.upstream.releaseDate = evidence.releaseDate;
  candidate.securityReview.reviewedAt = reviewedAt;
  candidate.securityReview.latestReviewedRelease = evidence.release;
  candidate.securityReview.latestReviewedCommit = evidence.commit;
  candidate.securityReview.latestReviewedReleaseDate = evidence.releaseDate;
  return candidate;
}

export function classifyChangedPath(path) {
  if (path.startsWith(".github/workflows/")) {
    return "inherited-workflows";
  }
  if (path === "package.json" || path.endsWith("lock.yaml") || path.endsWith("lock.json")) {
    return "security-sensitive-dependencies";
  }
  if (path.startsWith("extensions/") || path.startsWith("src/plugins/")) {
    return "plugin-runtime-seams";
  }
  if (path.includes("schema") || path.endsWith(".proto")) {
    return "schemas";
  }
  if (
    path.startsWith("scripts/weaver/") ||
    path.startsWith("docs/weaver/") ||
    path.startsWith("weaver.")
  ) {
    return "distribution-files";
  }
  return "upstream-runtime";
}

export function buildChangeInventory(changedPaths) {
  const groups = {};
  for (const path of [...new Set(changedPaths)].toSorted((left, right) =>
    left.localeCompare(right),
  )) {
    const group = classifyChangedPath(path);
    groups[group] ??= [];
    groups[group].push(path);
  }
  return {
    schemaVersion: 1,
    changedFiles: Object.values(groups).reduce((total, paths) => total + paths.length, 0),
    groups,
  };
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`invalid argument sequence near ${JSON.stringify(key)}`);
    }
    options[key.slice(2)] = value;
  }
  return { command, options };
}

async function githubJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "weaver-upstream-update",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${url}`);
  }
  return response.json();
}

async function discover(options) {
  const policyPath = resolve(repoRoot, options.policy ?? "weaver.fork-policy.json");
  const outputPath = resolve(options.output);
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  const token = requireString(process.env.GITHUB_TOKEN, "GITHUB_TOKEN");
  const release = await githubJson(policy.upstream.stableReleaseApi, token);
  const encodedTag = encodeURIComponent(release.tag_name);
  const tagRef = await githubJson(
    `https://api.github.com/repos/openclaw/openclaw/git/ref/tags/${encodedTag}`,
    token,
  );
  if (tagRef.object?.type !== "tag") {
    throw new Error("stable release ref is not an annotated tag");
  }
  const tagObject = await githubJson(tagRef.object.url, token);
  tagObject.sha = tagRef.object.sha;
  const evidence = validateReleaseDiscovery({ policy, release, tagRef, tagObject });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  if (options["github-output"]) {
    const lines = [
      `update_available=${evidence.updateAvailable}`,
      `release=${evidence.release}`,
      `commit=${evidence.commit}`,
      `tag_object=${evidence.tagObject}`,
      `release_date=${evidence.releaseDate}`,
    ];
    writeFileSync(options["github-output"], `${lines.join("\n")}\n`, { flag: "a" });
  }
}

function updatePolicy(options) {
  const policyPath = resolve(repoRoot, options.policy ?? "weaver.fork-policy.json");
  const evidence = JSON.parse(readFileSync(resolve(options.evidence), "utf8"));
  const reviewedAt = requireString(options["reviewed-at"], "--reviewed-at");
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  writeFileSync(
    policyPath,
    `${JSON.stringify(buildCandidatePolicy(policy, evidence, reviewedAt), null, 2)}\n`,
  );
}

function inventory(options) {
  const base = requireString(options.base, "--base");
  const head = requireString(options.head, "--head");
  const changedPaths = execFileSync("git", ["diff", "--name-only", `${base}..${head}`, "--"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  const result = {
    ...buildChangeInventory(changedPaths),
    base,
    head,
  };
  writeFileSync(resolve(options.output), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "discover") {
    await discover(options);
  } else if (command === "update-policy") {
    updatePolicy(options);
  } else if (command === "inventory") {
    inventory(options);
  } else {
    throw new Error("usage: prepare-upstream-update.mjs <discover|update-policy|inventory> ...");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((/** @type {unknown} */ error) => {
    console.error(`weaver-upstream-update: ${error.message}`);
    process.exitCode = 1;
  });
}
