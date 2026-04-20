import { ChannelFactory } from './channel-provider.js';

export interface ChannelProviderSetupContext {
  runtimeHome: string;
  prompt: (question: string) => Promise<string>;
  confirm: (question: string) => Promise<boolean>;
}

export interface ChannelProviderSetup {
  envKeys: readonly string[];
  describe: () => string;
  run: (ctx: ChannelProviderSetupContext) => Promise<void>;
}

export interface ChannelProviderSettingsLike {
  channels: Record<string, { enabled: boolean }>;
}

export type ChannelFormattingDialect =
  | 'none'
  | 'markdown-native'
  | 'mrkdwn'
  | 'telegram-html';

export interface ChannelProvider {
  id: string;
  label: string;
  jidPrefix: string;
  folderPrefix: string;
  isGroupJid: (jid: string) => boolean;
  formatting: ChannelFormattingDialect;
  isEnabled: (settings: ChannelProviderSettingsLike) => boolean;
  create: ChannelFactory;
  setup: ChannelProviderSetup;
}

const registry = new Map<string, ChannelProvider>();

export function registerChannelProvider(provider: ChannelProvider): void {
  if (registry.has(provider.id)) {
    throw new Error(`Duplicate channel provider id: ${provider.id}`);
  }
  registry.set(provider.id, provider);
}

export function getChannelProvider(id: string): ChannelProvider | undefined {
  return registry.get(id);
}

export function listChannelProviders(): readonly ChannelProvider[] {
  return Array.from(registry.values());
}

export function providerForJid(jid: string): ChannelProvider | undefined {
  for (const provider of registry.values()) {
    if (jid.startsWith(provider.jidPrefix)) {
      return provider;
    }
  }
  return undefined;
}
