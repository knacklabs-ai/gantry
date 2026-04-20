import '../channels/register-builtins.js';

export {
  getChannelProvider,
  listChannelProviders,
  providerForJid,
  registerChannelProvider,
} from '../channels/provider-registry.js';
export type {
  ChannelProvider,
  ChannelProviderSetup,
  ChannelProviderSetupContext,
  ChannelFormattingDialect,
} from '../channels/provider-registry.js';
