export type WeaveControlPolicyMode = "disabled" | "background_read_only" | "approval_required";

export type WeaveControlRiskDetectionMode = "off" | "read_only";

export interface WeaveControlCapabilityGrant {
  capability: string;
  tools: string[];
  approvalRequired: boolean;
}

export interface WeaveControlOrganizationPolicy {
  organizationId: string;
  policyVersion: string;
  runtimeProfileHash: string;
  signedProfileRef: string;
  mode: WeaveControlPolicyMode;
  riskDetectionMode: WeaveControlRiskDetectionMode;
  whitelistedCapabilities: WeaveControlCapabilityGrant[];
  revokedCapabilities: string[];
  auditSinkRef: string;
  supportSafe: boolean;
}

export type GovernedActionDecision =
  | { allowed: true; approvalRequired: boolean; auditRef: string }
  | {
      allowed: false;
      reason:
        | "policy_invalid"
        | "capability_unknown"
        | "tool_unknown"
        | "capability_revoked"
        | "background_write_blocked";
    };

export interface GovernedActionRequest {
  capability: string;
  tool: string;
  write: boolean;
}

const VALID_MODES = new Set<WeaveControlPolicyMode>([
  "disabled",
  "background_read_only",
  "approval_required",
]);

const VALID_RISK_MODES = new Set<WeaveControlRiskDetectionMode>(["off", "read_only"]);

export function normalizeWeaveControlOrganizationPolicy(
  input: unknown,
): WeaveControlOrganizationPolicy | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const policy = input as Partial<WeaveControlOrganizationPolicy>;
  if (
    !isNonEmptyString(policy.organizationId) ||
    !isNonEmptyString(policy.policyVersion) ||
    !isNonEmptyString(policy.runtimeProfileHash) ||
    !isNonEmptyString(policy.signedProfileRef) ||
    !isNonEmptyString(policy.auditSinkRef) ||
    !policy.supportSafe ||
    !VALID_MODES.has(policy.mode as WeaveControlPolicyMode) ||
    !VALID_RISK_MODES.has(policy.riskDetectionMode as WeaveControlRiskDetectionMode) ||
    !Array.isArray(policy.whitelistedCapabilities) ||
    !Array.isArray(policy.revokedCapabilities)
  ) {
    return null;
  }

  const whitelistedCapabilities = policy.whitelistedCapabilities.map(normalizeGrant);
  if (whitelistedCapabilities.some((grant) => grant === null)) {
    return null;
  }
  if (!policy.revokedCapabilities.every(isNonEmptyString)) {
    return null;
  }

  return {
    organizationId: policy.organizationId,
    policyVersion: policy.policyVersion,
    runtimeProfileHash: policy.runtimeProfileHash,
    signedProfileRef: policy.signedProfileRef,
    mode: policy.mode as WeaveControlPolicyMode,
    riskDetectionMode: policy.riskDetectionMode as WeaveControlRiskDetectionMode,
    whitelistedCapabilities: whitelistedCapabilities as WeaveControlCapabilityGrant[],
    revokedCapabilities: policy.revokedCapabilities,
    auditSinkRef: policy.auditSinkRef,
    supportSafe: true,
  };
}

export function decideGovernedAction(
  policy: WeaveControlOrganizationPolicy | null,
  request: GovernedActionRequest,
): GovernedActionDecision {
  if (!policy || policy.mode === "disabled") {
    return { allowed: false, reason: "policy_invalid" };
  }
  if (policy.revokedCapabilities.includes(request.capability)) {
    return { allowed: false, reason: "capability_revoked" };
  }
  const grant = policy.whitelistedCapabilities.find(
    (candidate) => candidate.capability === request.capability,
  );
  if (!grant) {
    return { allowed: false, reason: "capability_unknown" };
  }
  if (!grant.tools.includes(request.tool)) {
    return { allowed: false, reason: "tool_unknown" };
  }
  if (request.write && policy.mode === "background_read_only") {
    return { allowed: false, reason: "background_write_blocked" };
  }
  return {
    allowed: true,
    approvalRequired:
      request.write || grant.approvalRequired || policy.mode === "approval_required",
    auditRef: `${policy.auditSinkRef}/${policy.policyVersion}/${request.capability}`,
  };
}

export function mobileActionRequestEvent(
  policy: WeaveControlOrganizationPolicy,
  request: GovernedActionRequest,
  requestId: string,
) {
  const decision = decideGovernedAction(policy, request);
  if (!decision.allowed) {
    return { type: "weaver.action_request.rejected" as const, requestId, reason: decision.reason };
  }
  return {
    type: "weaver.action_request.created" as const,
    requestId,
    capability: request.capability,
    toolRef: request.tool,
    requiresUserApproval: decision.approvalRequired,
    policyVersion: policy.policyVersion,
    runtimeProfileHash: policy.runtimeProfileHash,
    auditCorrelationRef: decision.auditRef,
    supportSafe: true,
  };
}

function normalizeGrant(input: unknown): WeaveControlCapabilityGrant | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const grant = input as Partial<WeaveControlCapabilityGrant>;
  if (
    !isNonEmptyString(grant.capability) ||
    !Array.isArray(grant.tools) ||
    !grant.tools.every(isNonEmptyString)
  ) {
    return null;
  }
  return {
    capability: grant.capability,
    tools: grant.tools,
    approvalRequired: grant.approvalRequired === true,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
