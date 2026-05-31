import { DEFAULT_WEAVE_CHAT_ACCOUNT_ID } from "./constants.js";
import type { CoreConfig, ResolvedWeaveChatAccount, WeaveChatAccountConfig } from "./types.js";

export function listWeaveChatAccountIds(cfg: CoreConfig): string[] {
  const channel = cfg.channels?.["weave-chat"];
  const accountIds = Object.keys(channel?.accounts ?? {});
  return accountIds.length === 0 ? [DEFAULT_WEAVE_CHAT_ACCOUNT_ID] : accountIds.sort();
}

export function resolveDefaultWeaveChatAccountId(cfg: CoreConfig): string {
  return cfg.channels?.["weave-chat"]?.defaultAccount ?? DEFAULT_WEAVE_CHAT_ACCOUNT_ID;
}

export function resolveWeaveChatAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedWeaveChatAccount {
  const channel = params.cfg.channels?.["weave-chat"];
  const accountId = params.accountId ?? channel?.defaultAccount ?? DEFAULT_WEAVE_CHAT_ACCOUNT_ID;
  const account = channel?.accounts?.[accountId] ?? {};
  const merged: WeaveChatAccountConfig = { ...channel, ...account };
  const runtimeTokenRef = merged.runtimeTokenRef ?? merged.runtimeTokenCredentialRef;
  const configured = Boolean(
    merged.apiUrl &&
    merged.runtimeProfileHash &&
    merged.runtimeProfileVersion &&
    merged.userRuntimeId &&
    runtimeTokenRef,
  );
  return {
    accountId,
    enabled: merged.enabled ?? true,
    configured,
    apiUrl: merged.apiUrl ?? "",
    runtimeProfileHash: merged.runtimeProfileHash ?? "",
    runtimeProfileVersion: merged.runtimeProfileVersion ?? 0,
    userRuntimeId: merged.userRuntimeId ?? "",
    runtimeTokenRef: runtimeTokenRef ?? { source: "runtime-token", id: "missing" },
    webhookPath: merged.webhookPath ?? "/weave-chat/webhook",
    eventStreamPath: merged.eventStreamPath ?? "/weave-chat/events",
    defaultTo: merged.defaultTo,
  };
}
