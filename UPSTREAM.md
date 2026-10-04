# Upstream OpenClaw reference

Weaver is a thin governed distribution, not a reimplementation of OpenClaw.

## Exact candidate baseline

- Repository: https://github.com/openclaw/openclaw
- Stable release: `v2026.9.8`
- Published: `2026-10-03T03:21:47Z`
- Annotated tag object: `b1c1c6d3af1f68bc82efbb6c92fb224c36df8683`
- Peeled commit: `fc23bc864e4553c2d215e479eeec47b67a0bf943`
- Source tree: `92e461befd359758be6e2abde8ba80df2544653e`
- GitHub tag-signature verification: `verified=true`, `reason=valid`
- Upstream licence: MIT, with incorporated third-party notices retained.

The candidate tree starts from this upstream tree and reapplies only the declared Weaver-owned
files. It does not reuse the July runtime, dependency manifest, lockfile or generated upstream docs.

## Preserved boundaries

The agent loop, models, official Matrix plugin, MCP client, sessions, native approvals, skills,
memory, CLI, gateway and upstream security fixes come from the pinned release without core patches.
The RuntimeProfile guard and all six existing Weaver seam tests are retained unchanged.

The three downstream root package-script aliases are removed. Use the direct equivalents in
README and the operations guide. `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, runtime
sources and upstream notices must match the pinned release exactly.

No managed MCP capability is activated. Its current-domain/workload authorization proof remains
an independent requirement even if upstream now offers more authentication capabilities.

## Review and verification

The October 3 review covers the signed stable release metadata, current toolchain requirements,
changed baseline, unchanged distribution guard, and the recovery/update changes documented in
`CHANGELOG/2026.9.8.md`. It is not a claim that every upstream change since July was individually
audited or that a production cell was migrated.

Admission requires current GitHub execution evidence for signature verification, fork bounds,
the complete Weaver seam suite, production dependency audit and the upstream build. A date or
upstream release alone is not sufficient evidence. See [Review scope](docs/weaver/upstream-review.md).

## Upgrade and rollback

1. Discover a published stable release and verify its exact annotated tag, peeled commit and provenance.
2. Start from the new upstream tree; reapply only owned distribution files and refresh their documentation.
3. Preserve the zero-core-patch rule and review all changed paths against the fork budget.
4. Install the upstream lockfile and execute distribution, dependency and build checks.
5. Require live Matrix and current Weave integration evidence for the chosen deployment. If the optional
   managed-cell design is used, also require its control-plane and reconstruction evidence.
6. For managed cells, preserve the previous immutable runtime image and matching external state
   generation. Do not roll an older runtime onto state already migrated by a newer one.

A passing candidate build does not authorize deployment, release, security-limit relaxation or
history rewrite. The recurring updater in issue #39 / PR #41 remains a separate follow-up.
