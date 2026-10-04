---
summary: "Scope and verification requirements for the October 2026 upstream reconstruction"
title: "Upstream review"
---

# Upstream review

Review date: 2026-10-03 UTC. Target: OpenClaw v2026.9.8, commit
`fc23bc864e4553c2d215e479eeec47b67a0bf943`.

## Checked inputs

- The upstream releases API identifies a published, non-prerelease stable v2026.9.8.
- Annotated tag object `b1c1c6d3af1f68bc82efbb6c92fb224c36df8683` identifies that exact commit;
  GitHub reports a valid verified signature, not merely a signed merge commit.
- Current package metadata requires Node `>=24.16.0 <25 || >=26.1.0` and pins pnpm 12.5.1.
- The source tree is rebuilt from the verified release, with its actual current package metadata,
  lockfile, runtime, plugins and third-party notices. No old dependency pin is silently carried over.
- The unchanged Weaver guard uses only Node built-ins. Its complete six-test distribution suite is
  preserved, including rejection of literal credentials, extra channels and premature MCP access.
- The v2026.9.8 release notes cover update/state-recovery, container gateway ownership and other
  reliability fixes. The metadata advertises state schema 19 and agent schema 24; this is not proof
  that a previous live state generation can be safely migrated or downgraded.

## Required executable admission

The distribution workflow must pass signed-tag verification, unchanged-runtime/dependency checks,
fork bounds and actual-date freshness, every existing Weaver seam test, production dependency audit
and the current upstream build. No scan/build success is asserted by this document before CI finishes.
The historical July vulnerability findings are not assumed to be fixed merely from a version number.

## Deliberate non-claims

This is a source/provenance and distribution-compatibility review, not an exhaustive manual audit
of upstream history, a live Matrix test, proof of ARC integration, deployment authorization, a full
SBOM review or production certification. MCP stays disabled. No secrets or live state are used.
Issue #39 and PR #41 still own recurring signed-update automation and its broader acceptance.
