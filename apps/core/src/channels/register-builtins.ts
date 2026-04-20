import { registerChannelProvider } from './provider-registry.js';
import { slackProvider } from './slack.js';
import { telegramProvider } from './telegram.js';

registerChannelProvider(slackProvider);
registerChannelProvider(telegramProvider);
