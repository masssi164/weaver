---
summary: "Contribution licensing and DCO sign-off for the Weaver layer"
title: "Contributing to Weaver"
---

# Contributing to Weaver

## Choose the owning project

Changes to the OpenClaw runtime, agent loop, Matrix plugin, MCP client, sessions, skills, memory, or approvals belong upstream where possible and keep their MIT licensing. Follow the inherited OpenClaw contribution guide for that work.

Weaver-specific distribution, RuntimeProfile launch, fork-boundary, documentation, and focused test contributions follow the **EUPL-1.2-or-later** scope in [Weaver licensing](/weaver/licensing). Contributors retain their copyright. No copyright assignment or CLA is required.

## DCO sign-off

Use [Developer Certificate of Origin 1.1](https://developercertificate.org/) and sign each contribution commit with `git commit -s`:

```text
Signed-off-by: Your Name <your-email@example.com>
```

Sign only when you can certify DCO 1.1, including your right to submit the work under the applicable licence. Do not sign on another contributor's behalf. Existing upstream and third-party grants must remain intact.

## AI-assisted work and validation

AI-assisted development, documentation, research, and communication are welcome. Disclose material assistance in the pull request. The human contributor remains responsible for understanding, correctness, provenance, licensing, and reproducible validation. Model output is not proof of authorship or licence compatibility; do not publish secrets or private transcripts as provenance.

Follow the thin-fork policy and the existing distribution checks. Licence changes do not authorize runtime patches, a new approval system, or weaker security checks.
