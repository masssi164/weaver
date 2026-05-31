export type WeaveChatCredentialRef = {
  source: string;
  id: string;
};

export type WeaveChatAccountConfig = {
  enabled?: boolean;
  apiUrl?: string;
  runtimeProfileHash?: string;
  runtimeProfileVersion?: number;
  userRuntimeId?: string;
  runtimeTokenRef?: WeaveChatCredentialRef;
  runtimeTokenCredentialRef?: WeaveChatCredentialRef;
  webhookPath?: string;
  eventStreamPath?: string;
  defaultTo?: string;
};

export type WeaveChatConfig = WeaveChatAccountConfig & {
  accounts?: Record<string, Partial<WeaveChatAccountConfig>>;
  defaultAccount?: string;
};

export type CoreConfig = {
  channels?: {
    "weave-chat"?: WeaveChatConfig;
  };
  session?: {
    dmScope?: string;
  };
};

export type ResolvedWeaveChatAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  apiUrl: string;
  runtimeProfileHash: string;
  runtimeProfileVersion: number;
  userRuntimeId: string;
  runtimeTokenRef: WeaveChatCredentialRef;
  webhookPath: string;
  eventStreamPath: string;
  defaultTo?: string;
};

export type WeaveChatSendRequest = {
  target: string;
  text: string;
  threadId?: string;
  replyToId?: string;
  runtimeProfileHash: string;
  runtimeProfileVersion: number;
  userRuntimeId: string;
};

export type WeaveChatSendResult = {
  messageId: string;
};
