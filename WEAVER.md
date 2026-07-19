# Weaver Integration Contract

Status: target architecture. The current repository does not yet claim this contract is implemented.

Weaver is the Weave-governed, upstream-first OpenClaw runtime. It is not a collaboration domain and it does not replace Matrix, Files/WebDAV, Calendar/CalDAV or Weave MCP contracts.

## Ownership

- Weave and Keycloak own entitlement, organization policy, signed RuntimeProfile desired state, secret references, MCP authorization, side effects and audit.
- OpenClaw owns the agent loop, sessions, Matrix channel, workspace/memory/skill loaders, MCP client and native approval lifecycle.
- A Weaver cell executes those decisions for one entitled member and owns zero durable bytes.

RuntimeProfile configures a cell; it never authorizes a domain side effect. Weave rechecks identity, entitlement, policy, object scope and canonical arguments immediately before every MCP side effect.

## Stateless cell boundary

Durable state lives only in external authorities:

- member Files/WebDAV: bootstrap Markdown, `MEMORY.md`, `memory/**` and approved custom skills;
- Weave Control Store: desired-state references, lease/fencing, workspace HEAD, wake dedupe/outbox, conflicts and audit metadata;
- encrypted RuntimeStateStore: complete version-pinned `$OPENCLAW_STATE_DIR` checkpoint, including sessions/SQLite, native approvals, plugin/channel state and stable Matrix device/crypto state;
- Secret Manager/KMS: credentials, recovery material and encryption keys.

Generated config, a staged workspace/COW overlay, caches, indexes, processes and short-lived credentials are cell-local and disposable. WebDAV never stores SQLite, secrets or Matrix crypto state.

See [Stateless Weaver cell architecture](docs/architecture/stateless-weaver-cell.md) and the [implementation plan](docs/architecture/stateless-weaver-cell-implementation-plan.md). Tracking: [#32](https://github.com/masssi164/weaver/issues/32).

## Matrix and approvals

Members reach Weaver through the official OpenClaw Matrix plugin against the Weave Matrix facade. Do not create a separate `weave-chat` channel or approval inbox.

OpenClaw owns native approval request state, Matrix delivery and decision lifecycle. MCP owns invocation and elicitation. Weave reauthorizes and atomically executes the argument-bound action, then records immutable evidence. Tracking: [#30](https://github.com/masssi164/weaver/issues/30).

## Fork budget

No custom agent loop, Matrix channel, approval engine, memory/skill loader or MCP protocol. A core patch needs a proven upstream gap, isolated tests, owner, upstream/reference issue and deletion criterion. OpenClaw upgrades must prove checkpoint migration and rollback without relying on an old cell filesystem.
