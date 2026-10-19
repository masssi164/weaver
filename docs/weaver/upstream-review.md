---
summary: "Scope and verification requirements for the October 2026 upstream reconstruction"
title: "Upstream review"
---

# Upstream review

## Proposed baseline — source review complete; executable admission pending

Source review date: 2026-10-19 UTC. This records the bounded metadata, ownership and patch review,
not executable admission or a comprehensive vulnerability audit.

The published, non-prerelease stable v2026.10.5 identifies annotated tag
`9171d0a427738902efd811c648325cf54116743c`, peeled commit
`1b58cb9a1b4f4353e1add63c8506db4d890962e8`, tree
`a138559698570e238395121723a773106ac33f8c`. GitHub reported its signature
`verified=true`, `reason=valid` on October 19. Node requirements remain
`>=24.16.0 <25 || >=26.1.0`; upstream pins pnpm 12.9.0.

Source comparison finds the earlier MCP issuer fix and its regression upstream, with MCP SDK
1.32.0 and the source-map-js 1.2.2 override. Their eight downstream exceptions are removed.
The fork-local rollout coordinate and its regression remain the only declared exceptions.
All Weaver seams, dependency audit and the upstream build are still required. This source review
does not prove runtime compatibility, Weave integration, migration safety or production readiness.

## Historical October 3 review

Review date: 2026-10-03 UTC. Target: OpenClaw v2026.9.8, commit
`fc23bc864e4553c2d215e479eeec47b67a0bf943`.

### Historical checked inputs

- The upstream releases API identifies a published, non-prerelease stable v2026.9.8.
- Annotated tag object `b1c1c6d3af1f68bc82efbb6c92fb224c36df8683` identifies that exact commit;
  GitHub reports a valid verified signature, not merely a signed merge commit.
- The October 3 package metadata required Node `>=24.16.0 <25 || >=26.1.0` and pins pnpm 12.5.1.
- The source tree is rebuilt from the verified release, with its actual current package metadata,
  lockfile, runtime, plugins and third-party notices. No old dependency pin is silently carried over.
- The unchanged Weaver guard uses only Node built-ins. Its complete six-test distribution suite is
  preserved, including rejection of literal credentials, extra channels and premature MCP access.
- The v2026.9.8 release notes cover update/state-recovery, container gateway ownership and other
  reliability fixes. The metadata advertises state schema 19 and agent schema 24; this is not proof
  that a previous live state generation can be safely migrated or downgraded.

## Required executable admission — pending for the new baseline

The distribution workflow must pass signed-tag verification, protected upstream-input and declared-exception checks,
fork bounds and actual-date freshness, every existing Weaver seam test, production dependency audit
and the current upstream build. No scan/build success is asserted by this document before CI finishes.
The historical July vulnerability findings are not assumed to be fixed merely from a version number.

## Deliberate non-claims

This is a source/provenance and distribution-compatibility review, not an exhaustive manual audit
of upstream history, a live Matrix test, proof of ARC integration, deployment authorization, a full
SBOM review or production certification. MCP stays disabled. No secrets or live state are used.
Issue #39 and PR #41 still own recurring signed-update automation and its broader acceptance.
