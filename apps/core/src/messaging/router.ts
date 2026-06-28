import { ChannelOwnershipPort, NewMessage } from '../domain/types.js';
import { formatLocalTime } from '../shared/timezone.js';
import '../channels/register-builtins.js';
import { getProvider } from '../channels/provider-registry.js';
import { parseTextStyles } from './text-styles.js';

export interface ConversationContextMessages {
  recentChannelContext: NewMessage[];
  activeThreadContext: NewMessage[];
  currentMessages: NewMessage[];
}

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(
  messages: NewMessage[],
  timezone: string,
): string {
  const lines = messages.map((m) => {
    const displayTime = formatLocalTime(m.timestamp, timezone);
    const replyAttr = m.reply_to_message_id
      ? ` reply_to="${escapeXml(m.reply_to_message_id)}"`
      : '';
    const replySnippet =
      m.reply_to_message_content && m.reply_to_sender_name
        ? `\n  <quoted_message from="${escapeXml(m.reply_to_sender_name)}">${escapeXml(m.reply_to_message_content)}</quoted_message>`
        : '';
    return `<message sender="${escapeXml(m.sender_name)}" time="${escapeXml(displayTime)}"${replyAttr}>${replySnippet}${escapeXml(m.content)}</message>`;
  });

  const header = `<context timezone="${escapeXml(timezone)}" />\n`;

  return `${header}<messages>\n${lines.join('\n')}\n</messages>`;
}

export function formatConversationContextMessages(
  context: ConversationContextMessages,
  timezone: string,
): string {
  const header = `<context timezone="${escapeXml(timezone)}" />\n`;
  return `${header}<recent_channel_context trust="untrusted_conversation_data">\n${formatMessageLines(
    context.recentChannelContext,
    timezone,
  )}\n</recent_channel_context>\n<active_thread_context trust="untrusted_conversation_data">\n${formatMessageLines(
    context.activeThreadContext,
    timezone,
  )}\n</active_thread_context>\n<current_message trust="untrusted_conversation_data">\n${formatMessageLines(
    context.currentMessages,
    timezone,
  )}\n</current_message>`;
}

function formatMessageLines(messages: NewMessage[], timezone: string): string {
  return messages
    .map((message) => formatMessageLine(message, timezone))
    .join('\n');
}

function formatMessageLine(m: NewMessage, timezone: string): string {
  const displayTime = formatLocalTime(m.timestamp, timezone);
  const replyAttr = m.reply_to_message_id
    ? ` reply_to="${escapeXml(m.reply_to_message_id)}"`
    : '';
  const replySnippet =
    m.reply_to_message_content && m.reply_to_sender_name
      ? `\n  <quoted_message from="${escapeXml(m.reply_to_sender_name)}">${escapeXml(m.reply_to_message_content)}</quoted_message>`
      : '';
  return `<message sender="${escapeXml(m.sender_name)}" time="${escapeXml(displayTime)}"${replyAttr}>${replySnippet}${formatAttachmentLines(
    m.attachments,
  )}${escapeXml(m.content)}</message>`;
}

function formatAttachmentLines(attachments: NewMessage['attachments']): string {
  if (!attachments?.length) return '';
  return attachments
    .map((attachment) => {
      const attrs = [
        ['kind', attachment.kind],
        ['content_type', attachment.contentType],
        [
          'size_bytes',
          Number.isFinite(attachment.sizeBytes) && attachment.sizeBytes! >= 0
            ? Math.trunc(attachment.sizeBytes!).toString()
            : undefined,
        ],
        ['gantry_ref', formatGantryAttachmentRef(attachment.storageRef)],
      ]
        .filter(
          (attr): attr is [string, string] =>
            typeof attr[1] === 'string' && attr[1].length > 0,
        )
        .map(
          ([name, value]) =>
            `${name}="${escapeXml(boundedAttachmentAttr(value))}"`,
        )
        .join(' ');
      return `\n  <attachment ${attrs} />`;
    })
    .join('');
}

function boundedAttachmentAttr(value: string): string {
  return value.length > 160 ? value.slice(0, 160) : value;
}

function formatGantryAttachmentRef(storageRef?: string): string | undefined {
  if (!storageRef?.startsWith('attachments/')) return undefined;
  if (storageRef.includes('\\') || storageRef.includes('\0')) {
    return undefined;
  }
  if (storageRef.split('/').some((part) => part === '..')) {
    return undefined;
  }
  return storageRef;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

export function stripInternalTagsPreserveWhitespace(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '');
}

export function formatOutboundForChannel(
  rawText: string,
  channelId?: string,
): string {
  const text = stripInternalTags(rawText);
  if (!text || !channelId) {
    return text;
  }
  const provider = getProvider(channelId);
  if (!provider || provider.formatting === 'none') {
    return text;
  }
  return parseTextStyles(text, provider.formatting);
}

export function findChannel<T extends ChannelOwnershipPort>(
  channels: T[],
  jid: string,
): T | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
