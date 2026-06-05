import { describe, expect, it } from "vitest";
import {
  decideGovernedAction,
  mobileActionRequestEvent,
  normalizeWeaveControlOrganizationPolicy,
  type WeaveControlOrganizationPolicy,
} from "./governed-weaver-policy.js";

function policy(overrides: Partial<WeaveControlOrganizationPolicy> = {}) {
  const normalized = normalizeWeaveControlOrganizationPolicy({
    organizationId: "org-weave-dogfood",
    policyVersion: "org-policy-v30",
    runtimeProfileHash: "sha256:policy-profile",
    signedProfileRef: "weave-control://profiles/org-policy-v30.sig",
    mode: "background_read_only",
    riskDetectionMode: "read_only",
    whitelistedCapabilities: [
      {
        capability: "chat.send",
        tools: ["weave:chat:send-message"],
        approvalRequired: true,
      },
      {
        capability: "calendar.read",
        tools: ["weave:calendar:list-events"],
        approvalRequired: false,
      },
    ],
    revokedCapabilities: [],
    auditSinkRef: "audit://weaver/org-weave-dogfood",
    supportSafe: true,
    ...overrides,
  });
  expect(normalized).not.toBeNull();
  return normalized!;
}

describe("governed Weaver policy", () => {
  it("fails closed when Weave Control policy is missing, unsigned, or not support-safe", () => {
    expect(normalizeWeaveControlOrganizationPolicy(null)).toBeNull();
    expect(
      normalizeWeaveControlOrganizationPolicy({
        organizationId: "org",
        policyVersion: "v1",
        runtimeProfileHash: "sha256:x",
        mode: "approval_required",
        riskDetectionMode: "read_only",
        whitelistedCapabilities: [],
        revokedCapabilities: [],
        auditSinkRef: "audit://org",
        supportSafe: true,
      }),
    ).toBeNull();
    expect(
      normalizeWeaveControlOrganizationPolicy({
        organizationId: "org",
        policyVersion: "v1",
        runtimeProfileHash: "sha256:x",
        signedProfileRef: "weave-control://profiles/v1.sig",
        mode: "approval_required",
        riskDetectionMode: "read_only",
        whitelistedCapabilities: [],
        revokedCapabilities: [],
        auditSinkRef: "audit://org",
        supportSafe: false,
      }),
    ).toBeNull();
  });

  it("allows read-only background risk detection while blocking background writes", () => {
    expect(
      decideGovernedAction(policy(), {
        capability: "calendar.read",
        tool: "weave:calendar:list-events",
        write: false,
      }),
    ).toMatchObject({ allowed: true, approvalRequired: false });
    expect(
      decideGovernedAction(policy(), {
        capability: "chat.send",
        tool: "weave:chat:send-message",
        write: true,
      }),
    ).toEqual({ allowed: false, reason: "background_write_blocked" });
  });

  it("denies unknown and revoked capabilities before an action can run", () => {
    expect(
      decideGovernedAction(policy(), {
        capability: "files.delete",
        tool: "weave:files:delete",
        write: true,
      }),
    ).toEqual({ allowed: false, reason: "capability_unknown" });
    expect(
      decideGovernedAction(policy({ revokedCapabilities: ["calendar.read"] }), {
        capability: "calendar.read",
        tool: "weave:calendar:list-events",
        write: false,
      }),
    ).toEqual({ allowed: false, reason: "capability_revoked" });
  });

  it("emits support-safe mobile action request events with approval and audit refs", () => {
    expect(
      mobileActionRequestEvent(
        policy({ mode: "approval_required" }),
        {
          capability: "chat.send",
          tool: "weave:chat:send-message",
          write: true,
        },
        "war_01JHOTPHASE",
      ),
    ).toEqual({
      type: "weaver.action_request.created",
      requestId: "war_01JHOTPHASE",
      capability: "chat.send",
      toolRef: "weave:chat:send-message",
      requiresUserApproval: true,
      policyVersion: "org-policy-v30",
      runtimeProfileHash: "sha256:policy-profile",
      auditCorrelationRef: "audit://weaver/org-weave-dogfood/org-policy-v30/chat.send",
      supportSafe: true,
    });
  });
});
