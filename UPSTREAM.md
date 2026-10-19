# Upstream OpenClaw reference

Weaver is a thin governed distribution, not a reimplementation of OpenClaw.

## Exact candidate baseline

- Repository: https://github.com/openclaw/openclaw
- Stable release: `v2026.10.5`
- Published: `2026-10-18T21:47:25Z`
- Annotated tag object: `9171d0a427738902efd811c648325cf54116743c`
- Peeled commit: `1b58cb9a1b4f4353e1add63c8506db4d890962e8`
- Source tree: `a138559698570e238395121723a773106ac33f8c`
- GitHub tag-signature verification: `verified=true`, `reason=valid`
- Upstream licence: MIT, with incorporated third-party notices retained.

The candidate tree starts from this upstream tree and adds the declared Weaver-owned layer and
`approvedCorePatches` in `weaver.fork-policy.json`. It does not reuse the July baseline.

## Preserved boundaries

The runtime comes from the pinned release with only the explicitly approved downstream patches.
Each exception records its upstream reference, removal criterion, and line budget in the fork policy.
The RuntimeProfile guard, Weaver seam tests, and upstream licence notices remain in place.

The three downstream root package-script aliases are removed. Use the direct equivalents in
README and the operations guide. `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, runtime
sources must match the pinned release except for those declared patches. Upstream notices remain intact.

No managed MCP capability is activated. Its current-domain/workload authorization proof remains
an independent requirement even if upstream now offers more authentication capabilities.

## Review and verification

The new signed baseline includes the earlier MCP issuer and dependency fixes, so their eight
patch exceptions are removed. Only the two declared fork-local security-review rollout exceptions
remain. The actual October 19 source review and historical October 3 review are recorded separately;
hosted distribution validation is pending. No currentness or runtime admission is claimed
until those existing gates pass.

## Upgrade and rollback

1. Discover a published stable release and verify its exact annotated tag, peeled commit and provenance.
2. Start from the new upstream tree; reapply only owned distribution files and refresh their documentation.
3. Reassess approved exceptions against their removal criteria and review all changed paths against the fork budgets.
4. Install the upstream lockfile and execute distribution, dependency and build checks.
5. Require live Matrix and current Weave integration evidence for the chosen deployment. If the optional
   managed-cell design is used, also require its control-plane and reconstruction evidence.
6. For managed cells, preserve the previous immutable runtime image and matching external state
   generation. Do not roll an older runtime onto state already migrated by a newer one.

A passing candidate build does not authorize deployment, release, security-limit relaxation or
history rewrite. The recurring updater in issue #39 / PR #41 remains a separate follow-up.
