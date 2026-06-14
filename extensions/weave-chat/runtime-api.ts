export type { ChannelGatewayContext } from "openclaw/plugin-sdk/channel-contract";
export type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";

export {
  createWeaveChatInboundRuntimeContext,
  getWeaveChatInboundRuntimeContext,
  registerWeaveChatInboundRuntimeContext,
} from "./src/inbound.js";
export type { WeaveChatInboundRuntimeContext } from "./src/inbound.js";
