import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateChangeBudget,
  validateForkPolicy,
} from "../../scripts/weaver/check-fork-boundary.mjs";
import {
  validateProjectedConfig,
  validateProjectionEnvelope,
} from "../../scripts/weaver/launch-from-runtime-profile.mjs";
import {
  buildCandidatePolicy,
  buildChangeInventory,
  compareStableReleaseVersions,
  validateReleaseDiscovery,
} from "../../scripts/weaver/prepare-upstream-update.mjs";

const workspace = "/run/weaver/cell/workspace";
const secretRef = { source: "env", provider: "default", id: "MATRIX_ACCESS_TOKEN" };

function validConfig() {
  return {
    agents: { defaults: { workspace } },
    channels: {
      matrix: {
        enabled: true,
        encryption: true,
        homeserver: "https://matrix.weave.example",
        accessToken: secretRef,
      },
    },
  };
}

function validPolicy() {
  return {
    schemaVersion: 1,
    upstream: {
      repository: "https://github.com/openclaw/openclaw",
      stableReleaseApi: "https://api.github.com/repos/openclaw/openclaw/releases/latest",
      allowedSignersFile: "weaver.upstream-allowed-signers",
      release: "v2026.7.1",
      commit: "2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4",
      releaseDate: "2026-07-13",
      retiredCommits: [],
    },
    securityReview: {
      reviewedAt: "2026-07-19",
      latestReviewedRelease: "v2026.7.1",
      latestReviewedCommit: "2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4",
      latestReviewedReleaseDate: "2026-07-13",
    },
    distributionPaths: ["README.md", "docs/weaver/"],
    approvedPlugins: [],
    approvedCorePatches: [],
    budgets: {
      maxChangedFiles: 2,
      maxChangedCoreFiles: 0,
      maxNonPluginPatchLines: 100,
      maxSecurityReleaseLagDays: 7,
      maxSecurityReviewAgeDays: 14,
    },
  };
}

describe("RuntimeProfile projection guard", () => {
  it("accepts encrypted Matrix while MCP remains dark", () => {
    expect(validateProjectedConfig(validConfig(), workspace)).toEqual(validConfig());
  });

  it("binds projector output to the exact RuntimeProfile bytes", () => {
    const profile = Buffer.from('{"payload":"signed-runtime-profile-v2"}\n');
    const digest = createHash("sha256").update(profile).digest("hex");
    const envelope = {
      protocolVersion: "weaver.profile-projection/v2",
      contractVersion: "weave.runtime-profile/v2",
      profileId: "rp_example",
      cellRef: "cell:example",
      workloadClientId: "weaver-cell-example",
      profileSha256: `sha256:${digest}`,
      signatureVerified: true,
      disabledCapabilities: ["mcp"],
      openclawConfig: validConfig(),
    };
    expect(
      validateProjectionEnvelope(
        envelope,
        profile,
        workspace,
        "cell:example",
        "weaver-cell-example",
      ),
    ).toEqual(validConfig());
    expect(() =>
      validateProjectionEnvelope(
        { ...envelope, signatureVerified: false },
        profile,
        workspace,
        "cell:example",
        "weaver-cell-example",
      ),
    ).toThrow(/signature verification/);
    expect(() =>
      validateProjectionEnvelope(
        { ...envelope, workloadClientId: "weaver-cell-other" },
        profile,
        workspace,
        "cell:example",
        "weaver-cell-example",
      ),
    ).toThrow(/workloadClientId/);
  });

  it("rejects literal credentials, additional channels, and premature MCP projection", () => {
    const literalToken = validConfig();
    literalToken.channels.matrix.accessToken = "secret" as never;
    expect(() => validateProjectedConfig(literalToken, workspace)).toThrow(/SecretRef/);

    const extraChannel = validConfig() as ReturnType<typeof validConfig> & {
      channels: ReturnType<typeof validConfig>["channels"] & { slack: { enabled: boolean } };
    };
    extraChannel.channels.slack = { enabled: true };
    expect(() => validateProjectedConfig(extraChannel, workspace)).toThrow(/unknown key/);

    const prematureMcp = { ...validConfig(), mcp: { servers: {} } };
    expect(() => validateProjectedConfig(prematureMcp, workspace)).toThrow(
      /client-credentials extension/,
    );
  });

  it("runs a trusted projector and writes one private ephemeral config", () => {
    const root = mkdtempSync(join(tmpdir(), "weaver-profile-launch-"));
    try {
      const profile = join(root, "runtime-profile.json");
      const projector = join(root, "projector.mjs");
      const cell = join(root, "cell");
      const state = join(cell, "state");
      const projectedWorkspace = join(cell, "workspace");
      const config = join(cell, "generated", "openclaw.json");
      mkdirSync(state, { recursive: true });
      mkdirSync(projectedWorkspace);
      writeFileSync(profile, '{"payload":"signed-runtime-profile-v2"}\n');
      writeFileSync(
        projector,
        `#!${process.execPath}\nimport { createHash } from "node:crypto";\nimport { readFileSync } from "node:fs";\nconst value = (name) => process.argv[process.argv.indexOf(name) + 1];\nconst profile = readFileSync(value("--profile"));\nconst workspace = value("--workspace");\nconsole.log(JSON.stringify({\n  protocolVersion: "weaver.profile-projection/v2",\n  contractVersion: "weave.runtime-profile/v2",\n  profileId: "rp_example",\n  cellRef: value("--cell-ref"),\n  workloadClientId: value("--workload-client-id"),\n  profileSha256: "sha256:" + createHash("sha256").update(profile).digest("hex"),\n  signatureVerified: true,\n  disabledCapabilities: ["mcp"],\n  openclawConfig: {\n    agents: { defaults: { workspace } },\n    channels: { matrix: { enabled: true, encryption: true, homeserver: "https://matrix.weave.example", accessToken: { source: "env", provider: "default", id: "MATRIX_ACCESS_TOKEN" } } }\n  }\n}));\n`,
        { mode: 0o700 },
      );
      chmodSync(projector, 0o700);
      const result = spawnSync(
        process.execPath,
        [
          resolve("scripts/weaver/launch-from-runtime-profile.mjs"),
          "--profile",
          profile,
          "--projector",
          projector,
          "--ephemeral-root",
          cell,
          "--config",
          config,
          "--state-dir",
          state,
          "--workspace",
          projectedWorkspace,
          "--cell-ref",
          "cell:example",
          "--workload-client-id",
          "weaver-cell-example",
          "--check",
        ],
        { encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(readFileSync(config, "utf8")).agents.defaults.workspace).toBe(
        projectedWorkspace,
      );
      expect(statSync(config).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("fork budget", () => {
  it("accepts a bounded distribution-only delta", () => {
    const result = evaluateChangeBudget({
      policy: validPolicy(),
      changes: [
        { path: "README.md", added: 10, deleted: 4, binary: false },
        { path: "docs/weaver/architecture.md", added: 40, deleted: 0, binary: false },
      ],
      today: "2026-07-19",
    });
    expect(result.failures).toEqual([]);
    expect(result.metrics?.changedCoreFiles).toBe(0);
  });

  it("rejects unapproved core changes and incomplete exceptions", () => {
    const result = evaluateChangeBudget({
      policy: validPolicy(),
      changes: [{ path: "src/agents/run.ts", added: 1, deleted: 0, binary: false }],
      today: "2026-07-19",
    });
    expect(result.failures).toContain("src/agents/run.ts is an unapproved OpenClaw core patch");

    const policy = validPolicy();
    policy.approvedCorePatches = [
      {
        path: "src/agents/run.ts",
        owner: "runtime-owner",
        removalCriterion: "Remove when upstream exposes the required seam.",
        maxPatchLines: 10,
      } as never,
    ];
    expect(validateForkPolicy(policy).join("\n")).toMatch(/upstreamIssue/);
  });

  it("allows at most one current, fully owned temporary core patch", () => {
    const policy = validPolicy();
    const approval = {
      path: "src/agents/run.ts",
      owner: "runtime-owner",
      removalCriterion: "Remove when upstream exposes the required seam.",
      maxPatchLines: 10,
      upstreamIssue: "https://github.com/openclaw/openclaw/issues/123",
      reviewedBy: "security-owner",
      reviewedAt: "2026-07-18",
      reviewDue: "2026-08-01",
      upstreamDisposition: "open",
    };
    policy.approvedCorePatches = [approval] as never;
    policy.budgets.maxChangedCoreFiles = 1;
    expect(
      evaluateChangeBudget({
        policy,
        changes: [{ path: "src/agents/run.ts", added: 1, deleted: 0, binary: false }],
        today: "2026-07-19",
      }).failures,
    ).toEqual([]);

    policy.approvedCorePatches.push({ ...approval, path: "src/agents/other.ts" } as never);
    expect(validateForkPolicy(policy)).toContain(
      "approvedCorePatches permits at most one temporary OpenClaw core patch",
    );

    policy.approvedCorePatches = [{ ...approval, reviewDue: "2026-07-18" }] as never;
    expect(
      evaluateChangeBudget({
        policy,
        changes: [{ path: "src/agents/run.ts", added: 1, deleted: 0, binary: false }],
        today: "2026-07-19",
      }).failures,
    ).toContain("approvedCorePatches[0] security review is stale");
  });
});

describe("signed stable upstream discovery", () => {
  function releaseFixture(overrides = {}) {
    return {
      draft: false,
      prerelease: false,
      tag_name: "v2026.7.2",
      published_at: "2026-07-20T12:00:00Z",
      html_url: "https://github.com/openclaw/openclaw/releases/tag/v2026.7.2",
      ...overrides,
    };
  }

  function tagRefFixture(overrides = {}) {
    return {
      ref: "refs/tags/v2026.7.2",
      object: {
        type: "tag",
        sha: "a".repeat(40),
      },
      ...overrides,
    };
  }

  function tagObjectFixture(overrides = {}) {
    return {
      sha: "a".repeat(40),
      tag: "v2026.7.2",
      object: {
        type: "commit",
        sha: "b".repeat(40),
      },
      verification: {
        verified: true,
        reason: "valid",
        signature: "signed",
        verified_at: "2026-07-20T12:01:00Z",
      },
      ...overrides,
    };
  }

  it("accepts a newer signed stable annotated release and updates the policy pin", () => {
    const policy = validPolicy();
    const evidence = validateReleaseDiscovery({
      policy,
      release: releaseFixture(),
      tagRef: tagRefFixture(),
      tagObject: tagObjectFixture(),
    });
    expect(evidence).toMatchObject({
      updateAvailable: true,
      release: "v2026.7.2",
      tagObject: "a".repeat(40),
      commit: "b".repeat(40),
    });
    const candidate = buildCandidatePolicy(policy, evidence, "2026-07-21");
    expect(candidate.upstream.commit).toBe("b".repeat(40));
    expect(candidate.securityReview.reviewedAt).toBe("2026-07-21");
  });

  it("is idempotent for the exact pin and fails closed on mutable or unsafe releases", () => {
    const policy = validPolicy();
    const currentRef = tagRefFixture({
      ref: "refs/tags/v2026.7.1",
      object: { type: "tag", sha: "c".repeat(40) },
    });
    const currentObject = tagObjectFixture({
      sha: "c".repeat(40),
      tag: "v2026.7.1",
      object: { type: "commit", sha: policy.upstream.commit },
    });
    expect(
      validateReleaseDiscovery({
        policy,
        release: releaseFixture({
          tag_name: "v2026.7.1",
          published_at: "2026-07-13T22:33:14Z",
          html_url: "https://github.com/openclaw/openclaw/releases/tag/v2026.7.1",
        }),
        tagRef: currentRef,
        tagObject: currentObject,
      }).updateAvailable,
    ).toBe(false);

    expect(() =>
      validateReleaseDiscovery({
        policy,
        release: releaseFixture({ prerelease: true }),
        tagRef: tagRefFixture(),
        tagObject: tagObjectFixture(),
      }),
    ).toThrow(/non-prerelease/);
    expect(() =>
      validateReleaseDiscovery({
        policy,
        release: releaseFixture(),
        tagRef: tagRefFixture(),
        tagObject: tagObjectFixture({
          verification: { verified: false, reason: "unsigned", signature: null },
        }),
      }),
    ).toThrow(/valid signed annotated tag/);
    expect(() =>
      validateReleaseDiscovery({
        policy,
        release: releaseFixture({
          tag_name: "v2026.7.0",
          html_url: "https://github.com/openclaw/openclaw/releases/tag/v2026.7.0",
        }),
        tagRef: tagRefFixture({ ref: "refs/tags/v2026.7.0" }),
        tagObject: tagObjectFixture({ tag: "v2026.7.0" }),
      }),
    ).toThrow(/rolls back/);

    expect(() =>
      validateReleaseDiscovery({
        policy,
        release: releaseFixture({
          tag_name: "v2026.7.1",
          published_at: "2026-07-13T22:33:14Z",
          html_url: "https://github.com/openclaw/openclaw/releases/tag/v2026.7.1",
        }),
        tagRef: currentRef,
        tagObject: { ...currentObject, object: { type: "commit", sha: "d".repeat(40) } },
      }),
    ).toThrow(/moved/);

    policy.upstream.retiredCommits = ["b".repeat(40)];
    expect(() =>
      validateReleaseDiscovery({
        policy,
        release: releaseFixture(),
        tagRef: tagRefFixture(),
        tagObject: tagObjectFixture(),
      }),
    ).toThrow(/retired/);
  });

  it("compares stable versions numerically and inventories security-sensitive surfaces", () => {
    expect(compareStableReleaseVersions("v2026.7.10", "v2026.7.2")).toBe(1);
    expect(() => compareStableReleaseVersions("v2026.7.2-beta.1", "v2026.7.1")).toThrow(/stable/);
    expect(
      buildChangeInventory([
        "package.json",
        ".github/workflows/ci.yml",
        "src/plugins/loader.ts",
        "schemas/runtime.json",
        "src/agents/run.ts",
      ]).groups,
    ).toEqual({
      "inherited-workflows": [".github/workflows/ci.yml"],
      "security-sensitive-dependencies": ["package.json"],
      "plugin-runtime-seams": ["src/plugins/loader.ts"],
      schemas: ["schemas/runtime.json"],
      "upstream-runtime": ["src/agents/run.ts"],
    });
  });
});
