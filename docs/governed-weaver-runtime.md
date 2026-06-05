# Governed Weaver runtime

Weaver Sprint 30 defines a governed personal-assistant runtime contract that can consume Weave Control organization policy without Microsoft 365 lock-in.

## Source of truth

Weave Control and the Weave Admin Console own organization policy. Weaver consumes a support-safe signed profile with:

- organization id
- policy version
- runtime profile hash
- signed profile reference
- whitelisted capabilities and tools
- revoked capabilities
- audit sink reference

If the profile is missing, unsigned, not support-safe, unknown, or malformed, Weaver fails closed.

## Authority model

Weaver acts only with the user's rights plus organization-whitelisted capabilities. A capability is usable only when both the capability and the concrete tool are present in the current Weave Control policy. Unknown actions, unknown capabilities, unknown tools, and revoked capabilities are denied before execution.

## Background and risk-detection mode

The Scout-like catch-up mode is bounded as `background_read_only` plus `riskDetectionMode=read_only` until stronger evidence exists. In that mode Weaver may inspect authorized read-only signals to surface coordination gaps and risk summaries, but it cannot write, send, delete, mutate provider state, or trigger external side effects.

Write actions require `approval_required` policy mode plus a mobile action request, explicit user decision, support-safe approval receipt, audit ref, and revocation boundary.

## Mobile action request events

Phone approvals use two support-safe event contracts:

- `weaver.action_request.created` asks the user to approve, deny, or revoke a capability for a specific request.
- `weaver.action_request.receipt` records the decision with receipt, audit, and revocation refs.

Payloads must not include raw prompts, private member content, raw provider payloads, secret values, credential URLs, or raw downstream errors. Admins may see posture metadata by default: request id, capability, policy version, profile hash, decision, audit ref, and revocation ref. Admins do not see member private memory, full drafted content, or raw provider responses by default.

## Data sovereignty and privacy boundary

Weaver remains provider-neutral and self-hosting compatible. Organization policy decides which tools and capabilities are whitelisted; the runtime does not assume M365, Graph, Exchange, Teams, Slack, Matrix, or Nextcloud as a default authority source.

Private user memory, raw prompts, provider payloads, credential material, and member content stay out of support evidence and admin-facing posture by default. Evidence is limited to support-safe refs, hashes, capability names, state, decisions, audit refs, and revocation refs.

## Contract evidence

The executable contract lives in `src/weave-control/governed-weaver-policy.ts` and is covered by `src/weave-control/governed-weaver-policy.test.ts`.
