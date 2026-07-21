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
      release: "v2026.7.1",
      commit: "2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4",
      releaseDate: "2026-07-13",
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
});
