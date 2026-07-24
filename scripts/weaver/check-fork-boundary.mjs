#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const policyPath = resolve(repoRoot, "weaver.fork-policy.json");
const dayMs = 24 * 60 * 60 * 1000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function runGit(args, options = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.quiet ? "ignore" : "pipe"],
  }).trim();
}

function gitSucceeds(args) {
  return spawnSync("git", args, { cwd: repoRoot, stdio: "ignore" }).status === 0;
}

function parseDate(value, field, failures) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    failures.push(`${field} must be an ISO calendar date`);
    return undefined;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    failures.push(`${field} is not a valid calendar date`);
    return undefined;
  }
  return parsed;
}

function requireString(value, field, failures) {
  if (typeof value !== "string" || value.trim().length === 0) {
    failures.push(`${field} must be a non-empty string`);
    return false;
  }
  return true;
}

function requireInteger(value, field, failures) {
  if (!Number.isSafeInteger(value) || value < 0) {
    failures.push(`${field} must be a non-negative integer`);
    return false;
  }
  return true;
}

function matchesPath(path, declaredPath) {
  return declaredPath.endsWith("/") ? path.startsWith(declaredPath) : path === declaredPath;
}

function matchingEntry(path, entries) {
  return entries.find((entry) => matchesPath(path, entry.path));
}

export function validateForkPolicy(policy) {
  const failures = [];
  if (!isRecord(policy) || policy.schemaVersion !== 1) {
    return ["policy schemaVersion must be 1"];
  }

  const { upstream, securityReview, budgets } = policy;
  if (!isRecord(upstream)) {
    failures.push("upstream must be an object");
  } else {
    requireString(upstream.repository, "upstream.repository", failures);
    if (
      !requireString(upstream.stableReleaseApi, "upstream.stableReleaseApi", failures) ||
      !/^https:\/\/api\.github\.com\/repos\/openclaw\/openclaw\/releases\/latest$/.test(
        upstream.stableReleaseApi ?? "",
      )
    ) {
      failures.push(
        "upstream.stableReleaseApi must use the configured OpenClaw latest-release API",
      );
    }
    requireString(upstream.allowedSignersFile, "upstream.allowedSignersFile", failures);
    if (
      typeof upstream.allowedSignersFile === "string" &&
      (upstream.allowedSignersFile.startsWith("/") || upstream.allowedSignersFile.includes(".."))
    ) {
      failures.push("upstream.allowedSignersFile must be a repository-relative safe path");
    }
    requireString(upstream.release, "upstream.release", failures);
    if (!/^[a-f0-9]{40}$/.test(upstream.commit ?? "")) {
      failures.push("upstream.commit must be a full lowercase Git commit");
    }
    parseDate(upstream.releaseDate, "upstream.releaseDate", failures);
    if (!Array.isArray(upstream.retiredCommits)) {
      failures.push("upstream.retiredCommits must be an array");
    } else {
      const retired = new Set();
      for (const [index, commit] of upstream.retiredCommits.entries()) {
        if (typeof commit !== "string" || !/^[a-f0-9]{40}$/.test(commit)) {
          failures.push(`upstream.retiredCommits[${index}] must be a full lowercase Git commit`);
        } else if (retired.has(commit)) {
          failures.push(`upstream.retiredCommits contains duplicate commit ${commit}`);
        }
        retired.add(commit);
      }
      if (retired.has(upstream.commit)) {
        failures.push("the pinned upstream commit must not be retired");
      }
    }
  }

  if (!isRecord(securityReview)) {
    failures.push("securityReview must be an object");
  } else {
    parseDate(securityReview.reviewedAt, "securityReview.reviewedAt", failures);
    requireString(
      securityReview.latestReviewedRelease,
      "securityReview.latestReviewedRelease",
      failures,
    );
    if (!/^[a-f0-9]{40}$/.test(securityReview.latestReviewedCommit ?? "")) {
      failures.push("securityReview.latestReviewedCommit must be a full lowercase Git commit");
    }
    parseDate(
      securityReview.latestReviewedReleaseDate,
      "securityReview.latestReviewedReleaseDate",
      failures,
    );
  }

  if (!Array.isArray(policy.distributionPaths) || policy.distributionPaths.length === 0) {
    failures.push("distributionPaths must be a non-empty array");
  } else {
    const unique = new Set();
    for (const [index, path] of policy.distributionPaths.entries()) {
      if (!requireString(path, `distributionPaths[${index}]`, failures)) {
        continue;
      }
      if (path.startsWith("/") || path.includes("..") || unique.has(path)) {
        failures.push(
          `distributionPaths contains unsafe or duplicate path ${JSON.stringify(path)}`,
        );
      }
      if (path === "src/" || path === "extensions/" || path === "scripts/") {
        failures.push(`distribution path ${JSON.stringify(path)} is too broad`);
      }
      unique.add(path);
    }
  }

  for (const [kind, entries] of [
    ["approvedPlugins", policy.approvedPlugins],
    ["approvedCorePatches", policy.approvedCorePatches],
  ]) {
    if (!Array.isArray(entries)) {
      failures.push(`${kind} must be an array`);
      continue;
    }
    const paths = new Set();
    for (const [index, entry] of entries.entries()) {
      if (!isRecord(entry)) {
        failures.push(`${kind}[${index}] must be an object`);
        continue;
      }
      requireString(entry.path, `${kind}[${index}].path`, failures);
      requireString(entry.owner, `${kind}[${index}].owner`, failures);
      requireString(entry.removalCriterion, `${kind}[${index}].removalCriterion`, failures);
      requireInteger(entry.maxPatchLines, `${kind}[${index}].maxPatchLines`, failures);
      if (paths.has(entry.path)) {
        failures.push(`${kind} contains duplicate path ${JSON.stringify(entry.path)}`);
      }
      paths.add(entry.path);

      if (kind === "approvedPlugins") {
        requireString(entry.purpose, `${kind}[${index}].purpose`, failures);
        if (typeof entry.path === "string" && !/^extensions\/[^/]+\/$/.test(entry.path)) {
          failures.push(`${kind}[${index}].path must name one plugin directory`);
        }
      } else if (
        typeof entry.upstreamIssue !== "string" ||
        !/^https:\/\/github\.com\/openclaw\/openclaw\/(?:issues|pull)\/\d+$/.test(
          entry.upstreamIssue,
        )
      ) {
        failures.push(`${kind}[${index}].upstreamIssue must be an OpenClaw issue or pull request`);
      } else {
        requireString(entry.reviewedBy, `${kind}[${index}].reviewedBy`, failures);
        parseDate(entry.reviewedAt, `${kind}[${index}].reviewedAt`, failures);
        parseDate(entry.reviewDue, `${kind}[${index}].reviewDue`, failures);
        if (!["open", "accepted", "merged", "rejected"].includes(entry.upstreamDisposition)) {
          failures.push(
            `${kind}[${index}].upstreamDisposition must be open, accepted, merged, or rejected`,
          );
        }
      }
    }
  }

  if (Array.isArray(policy.approvedCorePatches) && policy.approvedCorePatches.length > 1) {
    failures.push("approvedCorePatches permits at most one temporary OpenClaw core patch");
  }

  if (!isRecord(budgets)) {
    failures.push("budgets must be an object");
  } else {
    for (const key of [
      "maxChangedFiles",
      "maxChangedCoreFiles",
      "maxNonPluginPatchLines",
      "maxSecurityReleaseLagDays",
      "maxSecurityReviewAgeDays",
    ]) {
      requireInteger(budgets[key], `budgets.${key}`, failures);
    }
  }
  return failures;
}

export function evaluateChangeBudget({ policy, changes, today }) {
  const failures = validateForkPolicy(policy);
  if (failures.length > 0) {
    return { failures, metrics: undefined };
  }

  const distribution = policy.distributionPaths.map((path) => ({ path }));
  const plugins = policy.approvedPlugins;
  const coreApprovals = policy.approvedCorePatches;
  const changedPaths = changes.map((change) => change.path).toSorted();
  const coreChanges = [];
  let nonPluginPatchLines = 0;

  for (const change of changes) {
    const plugin = matchingEntry(change.path, plugins);
    const distributionEntry = matchingEntry(change.path, distribution);
    if (!plugin) {
      nonPluginPatchLines += change.added + change.deleted;
    }
    if (change.binary) {
      failures.push(`${change.path} is binary; the Weaver delta must remain reviewable text`);
    }
    if (plugin && change.added + change.deleted > plugin.maxPatchLines) {
      failures.push(`${change.path} exceeds plugin patch budget ${plugin.maxPatchLines}`);
    }
    if (!plugin && !distributionEntry) {
      coreChanges.push(change);
      const approval = matchingEntry(change.path, coreApprovals);
      if (!approval) {
        failures.push(`${change.path} is an unapproved OpenClaw core patch`);
      } else if (change.added + change.deleted > approval.maxPatchLines) {
        failures.push(`${change.path} exceeds core patch budget ${approval.maxPatchLines}`);
      }
    }
  }

  for (const approval of [...plugins, ...coreApprovals]) {
    if (!changes.some((change) => matchesPath(change.path, approval.path))) {
      failures.push(`stale fork exception ${approval.path} has no changed file`);
    }
  }

  const pinnedDate = parseDate(policy.upstream.releaseDate, "upstream.releaseDate", failures);
  const latestDate = parseDate(
    policy.securityReview.latestReviewedReleaseDate,
    "securityReview.latestReviewedReleaseDate",
    failures,
  );
  const reviewedAt = parseDate(
    policy.securityReview.reviewedAt,
    "securityReview.reviewedAt",
    failures,
  );
  const checkDate = parseDate(today, "check date", failures);
  for (const [index, approval] of policy.approvedCorePatches.entries()) {
    const patchReviewedAt = parseDate(
      approval.reviewedAt,
      `approvedCorePatches[${index}].reviewedAt`,
      failures,
    );
    const reviewDue = parseDate(
      approval.reviewDue,
      `approvedCorePatches[${index}].reviewDue`,
      failures,
    );
    if (patchReviewedAt && checkDate && patchReviewedAt > checkDate) {
      failures.push(`approvedCorePatches[${index}] review date is in the future`);
    }
    if (reviewDue && checkDate && reviewDue < checkDate) {
      failures.push(`approvedCorePatches[${index}] security review is stale`);
    }
  }
  const securityReleaseLagDays =
    pinnedDate && latestDate ? Math.max(0, Math.floor((latestDate - pinnedDate) / dayMs)) : 0;
  const securityReviewAgeDays =
    reviewedAt && checkDate ? Math.floor((checkDate - reviewedAt) / dayMs) : 0;

  const metrics = {
    changedFiles: changedPaths.length,
    changedCoreFiles: coreChanges.length,
    nonPluginPatchLines,
    securityReleaseLagDays,
    securityReviewAgeDays,
  };
  const budgetMap = {
    changedFiles: "maxChangedFiles",
    changedCoreFiles: "maxChangedCoreFiles",
    nonPluginPatchLines: "maxNonPluginPatchLines",
    securityReleaseLagDays: "maxSecurityReleaseLagDays",
    securityReviewAgeDays: "maxSecurityReviewAgeDays",
  };
  for (const [metric, budget] of Object.entries(budgetMap)) {
    if (metrics[metric] > policy.budgets[budget]) {
      failures.push(`${metric}=${metrics[metric]} exceeds ${budget}=${policy.budgets[budget]}`);
    }
  }
  if (securityReviewAgeDays < 0) {
    failures.push("security review date is in the future");
  }
  return { failures, metrics };
}

function countUntrackedLines(path, failures) {
  const data = readFileSync(resolve(repoRoot, path));
  if (data.includes(0)) {
    failures.push(`${path} is an untracked binary file`);
    return { added: 0, binary: true };
  }
  let lines = 0;
  for (const byte of data) {
    if (byte === 10) {
      lines += 1;
    }
  }
  if (data.length > 0 && data.at(-1) !== 10) {
    lines += 1;
  }
  return { added: lines, binary: false };
}

function collectChanges(baseCommit, failures) {
  const changes = new Map();
  const rawNumstat = execFileSync(
    "git",
    ["diff", "--numstat", "--no-renames", "-z", baseCommit, "--"],
    { cwd: repoRoot },
  );
  for (const entry of rawNumstat.toString("utf8").split("\0")) {
    if (!entry) {
      continue;
    }
    const [addedRaw, deletedRaw, ...pathParts] = entry.split("\t");
    const path = pathParts.join("\t");
    const binary = addedRaw === "-" || deletedRaw === "-";
    changes.set(path, {
      path,
      added: binary ? 0 : Number.parseInt(addedRaw, 10),
      deleted: binary ? 0 : Number.parseInt(deletedRaw, 10),
      binary,
    });
  }

  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: repoRoot,
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  for (const path of untracked) {
    const counted = countUntrackedLines(path, failures);
    changes.set(path, { path, added: counted.added, deleted: 0, binary: counted.binary });
  }
  return [...changes.values()].toSorted((left, right) => left.path.localeCompare(right.path));
}

function verifyGitPin(policy, failures) {
  const tagType = runGit(["cat-file", "-t", policy.upstream.release], { quiet: true });
  if (tagType !== "tag") {
    failures.push(`${policy.upstream.release} must be an annotated tag`);
  }
  const peeled = runGit(["rev-parse", `${policy.upstream.release}^{}`], { quiet: true });
  if (peeled !== policy.upstream.commit) {
    failures.push(`upstream pin resolves to ${peeled}, expected ${policy.upstream.commit}`);
  }
  if (!gitSucceeds(["merge-base", "--is-ancestor", policy.upstream.commit, "HEAD"])) {
    failures.push("current branch is not based on the pinned upstream commit");
  }

  const latestType = runGit(["cat-file", "-t", policy.securityReview.latestReviewedRelease], {
    quiet: true,
  });
  if (latestType !== "tag") {
    failures.push(`${policy.securityReview.latestReviewedRelease} must be an annotated tag`);
  }
  const latestPeeled = runGit(["rev-parse", `${policy.securityReview.latestReviewedRelease}^{}`], {
    quiet: true,
  });
  if (latestPeeled !== policy.securityReview.latestReviewedCommit) {
    failures.push(
      `reviewed release resolves to ${latestPeeled}, expected ${policy.securityReview.latestReviewedCommit}`,
    );
  }
}

function main() {
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  const failures = validateForkPolicy(policy);
  if (failures.length === 0) {
    try {
      verifyGitPin(policy, failures);
    } catch (error) {
      failures.push(`unable to verify Git pins: ${error.message}`);
    }
  }
  const changes = collectChanges(policy.upstream?.commit ?? "HEAD", failures);
  const today = process.env.WEAVER_FORK_CHECK_DATE || new Date().toISOString().slice(0, 10);
  const result = evaluateChangeBudget({ policy, changes, today });
  failures.push(...result.failures);

  const summary = {
    upstreamRelease: policy.upstream.release,
    upstreamCommit: policy.upstream.commit,
    checkDate: today,
    metrics: result.metrics,
    approvedPlugins: policy.approvedPlugins.length,
    approvedCorePatches: policy.approvedCorePatches.length,
  };
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ...summary, ok: failures.length === 0, failures }, null, 2));
  } else {
    console.log(`weaver-fork-boundary: ${failures.length === 0 ? "ok" : "failed"}`);
    console.log(JSON.stringify(summary, null, 2));
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
  }
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
