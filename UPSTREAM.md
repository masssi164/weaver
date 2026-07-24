# Upstream OpenClaw Reference

Weaver is a thin distribution of [OpenClaw](https://github.com/openclaw/openclaw), not an
independent agent-runtime implementation.

## Pinned baseline

| Field               | Value                                      |
| ------------------- | ------------------------------------------ |
| Upstream repository | `https://github.com/openclaw/openclaw`     |
| Annotated release   | `v2026.7.1`                                |
| Release commit      | `2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4` |
| Release date        | 2026-07-13                                 |
| License             | MIT                                        |

The baseline is recorded again in `weaver.fork-policy.json` so CI can verify the annotated tag,
commit, review age, security-release lag, changed paths, and patch budget without relying on a
moving branch. `weaver.upstream-allowed-signers` is the reviewed SSH allowed-signers policy; GitHub
release metadata is corroborating evidence and cannot authorize a tag by itself.

## Inherited behavior

Unless a Weaver document explicitly narrows deployment policy, upstream OpenClaw owns and
documents:

- the agent loop and model/provider routing;
- the official Matrix plugin and E2EE/device behavior;
- the outbound MCP client registry and OAuth flow;
- sessions, native approvals, workspace memory, and skills;
- CLI, Gateway, plugin SDK, diagnostics, and release behavior.

The complete upstream documentation remains under `docs/` and is published at
<https://docs.openclaw.ai>. Weaver-specific code must use public configuration, plugin, or process
seams. It must not copy or fork these subsystems.

## Weaver-only delta

The permitted distribution delta is deliberately small:

- a Weaver-first repository entry point and operations/architecture documentation;
- a fail-closed wrapper around a trusted RuntimeProfile verifier/projector;
- a machine-readable fork policy and deterministic checker;
- focused tests for those distribution seams.

No core patch is approved in the initial policy. A future temporary core patch must name its owner,
reviewer, review and due dates, upstream OpenClaw issue or pull request, upstream disposition,
per-file line limit, and objective removal criterion. A second core patch or a stale review fails
closed. Adding a plugin likewise requires an explicit policy entry; placing code under
`extensions/` does not automatically exempt it from the fork budget.

## Downstream automation

The inherited `Auto response`, `Labeler`, `OpenGrep — PR Diff`, and `OpenGrep — Full` workflows are
disabled in the `masssi164/weaver` repository settings. The first pair requires OpenClaw-owned
GitHub App credentials; the OpenGrep pair hard-codes Blacksmith runner labels that are not
provisioned downstream. They are not Weaver build, security, or release evidence. Weaver neither
copies those private keys nor rewrites upstream workflow bytes.

`Weaver distribution / distribution-boundary` is the only downstream required check. It uses a
GitHub-hosted runner and no product secrets, verifies the annotated upstream tag object and exact
peeled commit through GitHub's signature-verification record, enforces the zero-core-patch budget,
and runs the focused distribution tests. Other inherited workflows are informational unless a
later reviewed policy explicitly adopts them. Inherited publishing, deployment, translation,
external-service, and live-transport workflows are not Weaver release authority and remain
unrequired; missing upstream credentials or unavailable runners never become a release waiver.
Issue #37 owns the settings inventory and quarantine record.

`Weaver signed upstream update` scans the configured stable channel every Tuesday and supports
manual dispatch. Candidate code runs in a read-only job without repository or product credentials.
Only after signature, fork, projection, contract, behavior, build, vulnerability, SBOM, provenance,
and fresh-clone gates pass does a separate job create the immutable `upstream/<version>-base`
reference and one draft update pull request. That credentialed job does not execute candidate code.
Repeated scans reuse an open update PR and never rewrite a baseline. The workflow never approves,
merges, deploys, publishes, changes the default branch, or promotes a readiness claim.

## Upgrade procedure

1. Fetch and verify the candidate annotated OpenClaw stable-release tag and its release notes.
2. Review upstream security advisories, Matrix/MCP/config changes, state-schema changes, and
   runtime release evidence.
3. Create the candidate branch from the peeled release commit, never by rebasing the previous
   Weaver fork.
4. Reapply only the permitted distribution files and update the pin plus security review in
   `weaver.fork-policy.json`.
5. Run the fork guard, focused distribution tests, upstream changed-surface checks, state inventory,
   checkpoint migration/rollback, real Matrix, and cross-node reconstruction evidence.
6. Promote only after the Agent Runtime Control conformance and release gates are green.

An upstream version bump is not ready merely because it builds. Weaver must prove that an encrypted
RuntimeState generation can be restored, migrated copy-on-write, checked with upstream health and
doctor paths, and rolled back without reading the old cell filesystem.

## Attribution

The upstream copyright and MIT terms are preserved in [LICENSE](LICENSE). Third-party attribution
is preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Weaver documentation describes
downstream policy and does not imply endorsement by the OpenClaw Foundation.
