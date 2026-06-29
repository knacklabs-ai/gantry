import type { RichInteractionRequest } from '../../domain/types.js';
import { logger } from '../../infrastructure/logging/logger.js';
import { slackThreadTsFromThreadId } from './thread-ts.js';
import {
  isRichForm,
  richDescriptor,
  RICH_INTERACTION_CANCEL_LABEL,
  RICH_INTERACTION_FALLBACK_COPY,
  RICH_INTERACTION_OPEN_FORM_LABEL,
  RICH_INTERACTION_REQUIRED_FIELDS_COPY,
  RICH_INTERACTION_SUBMIT_LABEL,
  RICH_INTERACTION_SUBMITTED_BY_COPY,
  richArrayItems,
  richFallbackText,
  richSlackEscape,
  richTruncate,
} from '../rich-interaction.js';

export function buildSlackRichInteractionBlocks(
  input: RichInteractionRequest,
): Array<Record<string, unknown>> {
  const item = richDescriptor(input);
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: richTruncate(item.title, 150),
        emoji: true,
      },
    },
  ];
  blocks.push(...slackRichPayloadBlocks(input));
  if (item.actions?.length) {
    blocks.push({
      type: 'actions',
      elements: item.actions.slice(0, 5).map((action) => ({
        type: 'button',
        text: {
          type: 'plain_text',
          text: richTruncate(action.label, 75),
          emoji: true,
        },
        action_id: `gantry_rich_${action.id}`,
        value: JSON.stringify({ interactionId: item.id, actionId: action.id }),
        style:
          action.style === 'danger'
            ? 'danger'
            : action.style === 'primary'
              ? 'primary'
              : undefined,
      })),
    });
  }
  if (isRichForm(input)) {
    blocks.push(
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: richSlackEscape(RICH_INTERACTION_REQUIRED_FIELDS_COPY),
          },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: RICH_INTERACTION_OPEN_FORM_LABEL,
              emoji: true,
            },
            action_id: 'gantry_rich_form_open',
            value: item.id,
            style: 'primary',
          },
        ],
      },
    );
  }
  return blocks;
}

function slackRichPayloadBlocks(
  input: RichInteractionRequest,
): Array<Record<string, unknown>> {
  const item = richDescriptor(input);
  const payload = item.rich?.payload ?? {};
  const bodyBlocks = item.body
    ? [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: richTruncate(richSlackEscape(item.body), 2900),
          },
        },
      ]
    : [];
  switch (item.rich?.kind) {
    case 'status':
      return [
        ...bodyBlocks,
        slackSection(
          [
            slackStatusLabel(payload.status ?? payload.state),
            scalarText(payload.body),
          ]
            .filter(Boolean)
            .join('\n'),
        ),
      ];
    case 'facts':
      return [
        ...bodyBlocks,
        ...fieldSections(
          richArrayItems(payload.facts).map((fact) => ({
            label: scalarText(fact.label) || 'Fact',
            value: scalarText(fact.value) || '-',
          })),
        ),
        ...detailFieldSections(input),
      ];
    case 'list':
      return [
        ...bodyBlocks,
        slackSection(
          richArrayItems(payload.items)
            .slice(0, 30)
            .map((listItem, index) =>
              slackListLine(listItem, index, payload.ordered === true),
            )
            .filter(Boolean)
            .join('\n'),
        ),
      ];
    case 'table':
      return [...bodyBlocks, slackSection(slackTable(payload))];
    case 'progress':
      return [
        ...bodyBlocks,
        slackSection(
          [
            scalarText(payload.label),
            slackProgressBar(
              typeof payload.value === 'number' ? payload.value : undefined,
              payload.done === true,
            ),
          ]
            .filter(Boolean)
            .join('\n'),
        ),
      ];
    case 'media':
      return [
        ...bodyBlocks,
        slackSection(
          richArrayItems(payload.items)
            .slice(0, 10)
            .map((mediaItem) => {
              const label =
                scalarText(mediaItem.caption) ||
                scalarText(mediaItem.alt) ||
                scalarText(mediaItem.mime_type) ||
                'Media';
              const url = scalarText(mediaItem.url);
              return url
                ? `• <${richSlackEscape(url)}|${richSlackEscape(label)}>`
                : `• ${richSlackEscape(label)}`;
            })
            .join('\n'),
          false,
        ),
      ];
    case 'form':
      return [
        ...bodyBlocks,
        slackSection(
          richArrayItems(payload.fields)
            .slice(0, 10)
            .map((field) => {
              const label = scalarText(field.label || field.id) || 'Field';
              const type = scalarText(field.type) || 'text';
              return `• *${richSlackEscape(label)}* (${richSlackEscape(type)})`;
            })
            .join('\n'),
        ),
      ];
    default:
      return [
        ...bodyBlocks,
        ...detailFieldSections(input),
        ...(bodyBlocks.length || item.details?.length
          ? []
          : [slackSection(richFallbackText(input))]),
      ];
  }
}

function slackSection(text: string, escape = true): Record<string, unknown> {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: richTruncate(
        escape ? richSlackEscape(text || '-') : text || '-',
        2900,
      ),
    },
  };
}

function fieldSections(
  fields: Array<{ label: string; value: string }>,
): Array<Record<string, unknown>> {
  const sections: Array<Record<string, unknown>> = [];
  for (let index = 0; index < fields.length; index += 10) {
    const slice = fields.slice(index, index + 10);
    if (!slice.length) continue;
    sections.push({
      type: 'section',
      fields: slice.map((field) => ({
        type: 'mrkdwn',
        text: `*${richSlackEscape(field.label)}*\n${richSlackEscape(field.value)}`,
      })),
    });
  }
  return sections;
}

function detailFieldSections(
  input: RichInteractionRequest,
): Array<Record<string, unknown>> {
  return fieldSections(
    (richDescriptor(input).details ?? []).slice(0, 10).map((detail) => ({
      label: detail.label,
      value: detail.value,
    })),
  );
}

function scalarText(value: unknown): string {
  return ['string', 'number', 'boolean'].includes(typeof value)
    ? String(value)
    : '';
}

function slackStatusLabel(value: unknown): string {
  const status = scalarText(value);
  if (!status) return '';
  const icon =
    status === 'success'
      ? ':white_check_mark:'
      : status === 'warning'
        ? ':warning:'
        : status === 'error'
          ? ':x:'
          : ':information_source:';
  return `${icon} *${status}*`;
}

function slackListLine(
  item: Record<string, unknown>,
  index: number,
  ordered: boolean,
): string {
  const title = scalarText(item.text) || scalarText(item.title);
  const detail = scalarText(item.detail) || scalarText(item.description);
  if (!title && !detail) return '';
  const prefix = ordered ? `${index + 1}.` : '•';
  return detail
    ? `${prefix} *${title || 'Item'}* — ${detail}`
    : `${prefix} ${title}`;
}

function slackTable(payload: Record<string, unknown>): string {
  const columns = richArrayItems(payload.columns).slice(0, 6);
  const rows = richArrayItems(payload.rows).slice(0, 12);
  const keys = columns
    .map((column) => scalarText(column.key))
    .filter((key): key is string => Boolean(key));
  if (!keys.length || !rows.length) return '-';
  const labels = columns.map((column, index) => ({
    key: keys[index],
    label: scalarText(column.label) || keys[index],
  }));
  const tableRows = [
    labels.map((column) => column.label),
    ...rows.map((row) => labels.map((column) => scalarText(row[column.key]))),
  ];
  const widths = labels.map((_, columnIndex) =>
    Math.min(
      24,
      Math.max(...tableRows.map((row) => (row[columnIndex] ?? '').length)),
    ),
  );
  const lines = tableRows.map((row) =>
    row
      .map((cell, columnIndex) =>
        richTruncate(cell || '-', widths[columnIndex]).padEnd(
          widths[columnIndex],
        ),
      )
      .join('  '),
  );
  lines.splice(1, 0, widths.map((width) => ''.padEnd(width, '-')).join('  '));
  return ['```', ...lines, '```'].join('\n');
}

function slackProgressBar(value: number | undefined, done: boolean): string {
  const normalized = done ? 100 : Math.max(0, Math.min(100, value ?? 0));
  const filled = Math.round(normalized / 10);
  const empty = 10 - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${normalized}%`;
}

export async function renderSlackRichInteraction(input: {
  app: any;
  jid: string;
  channelId: string;
  render: RichInteractionRequest;
  pendingRichForms: Map<string, RichInteractionRequest>;
  sendFallback: (
    text: string,
    options: { threadId?: string },
  ) => Promise<unknown>;
}): Promise<boolean> {
  const { app, jid, channelId, render, pendingRichForms, sendFallback } = input;
  try {
    if (isRichForm(render)) pendingRichForms.set(render.descriptor.id, render);
    await app.client.chat.postMessage({
      channel: channelId,
      text: richFallbackText(render),
      blocks: buildSlackRichInteractionBlocks(render) as any,
      ...(slackThreadTsFromThreadId(render.threadId)
        ? { thread_ts: slackThreadTsFromThreadId(render.threadId) }
        : {}),
    });
    return true;
  } catch (err) {
    logger.warn({ jid, err }, 'Slack rich interaction render failed');
    await sendFallback(
      `${RICH_INTERACTION_FALLBACK_COPY}\n\n${richFallbackText(render)}`,
      { threadId: render.threadId },
    );
    return true;
  }
}

export function registerSlackRichFormHandlers(input: {
  app: any;
  pendingRichForms: Map<string, RichInteractionRequest>;
}): void {
  const { app, pendingRichForms } = input;
  app.action('gantry_rich_form_open', async (args: any) => {
    await args.ack();
    const action = args.action as { value?: string };
    const body = args.body as {
      channel?: { id?: string };
      message?: { ts?: string; thread_ts?: string };
      trigger_id?: string;
    };
    if (!body.trigger_id) return;
    const request = pendingRichForms.get(action.value || '');
    if (!request) return;
    const payload = request.descriptor.rich?.payload ?? {};
    const fields = Array.isArray(payload.fields) ? payload.fields : [];
    await app.client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'gantry_rich_form_modal',
        private_metadata: JSON.stringify({
          channelId: body.channel?.id || '',
          interactionId: request.descriptor.id,
          threadTs: body.message?.thread_ts || body.message?.ts || '',
        }),
        title: {
          type: 'plain_text',
          text: (
            request.descriptor.title || RICH_INTERACTION_OPEN_FORM_LABEL
          ).slice(0, 24),
        },
        submit: { type: 'plain_text', text: RICH_INTERACTION_SUBMIT_LABEL },
        close: { type: 'plain_text', text: RICH_INTERACTION_CANCEL_LABEL },
        blocks: fields.length
          ? fields.slice(0, 10).map((field, index) => {
              const item =
                typeof field === 'object' && field !== null
                  ? (field as Record<string, unknown>)
                  : {};
              return {
                type: 'input',
                block_id: `gantry_rich_form_${index}`,
                optional: item.required !== true,
                label: {
                  type: 'plain_text',
                  text: String(
                    item.label || item.id || `Field ${index + 1}`,
                  ).slice(0, 150),
                },
                element: {
                  type: 'plain_text_input',
                  action_id: 'value',
                  multiline: item.type === 'textarea',
                },
              };
            })
          : [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: RICH_INTERACTION_REQUIRED_FIELDS_COPY,
                },
              },
            ],
      },
    });
  });
  app.view('gantry_rich_form_modal', async (args: any) => {
    await args.ack();
    const body = args.body as {
      user?: { id?: string; name?: string; username?: string };
    };
    const view = args.view as { private_metadata?: string };
    let meta: { channelId?: string; interactionId?: string; threadTs?: string };
    try {
      meta = JSON.parse(view.private_metadata || '{}');
    } catch {
      return;
    }
    if (!meta.channelId) return;
    if (meta.interactionId) pendingRichForms.delete(meta.interactionId);
    const displayName =
      body.user?.name || body.user?.username || body.user?.id || 'unknown';
    await app.client.chat.postMessage({
      channel: meta.channelId,
      text: `${RICH_INTERACTION_SUBMITTED_BY_COPY} ${displayName}.`,
      ...(meta.threadTs ? { thread_ts: meta.threadTs } : {}),
    });
  });
}
