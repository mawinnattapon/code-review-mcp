import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const DECISION_EMOJI: Record<string, string> = {
  APPROVE: '✅',
  'REQUEST CHANGES': '🔄',
  BLOCK: '🚫',
};

interface ReviewFinding {
  severity: string;
  category: string;
  description: string;
  location?: string;
}

interface ReviewJson {
  prId: string;
  provider?: string;
  decision: string;
  summary: string;
  findings: ReviewFinding[];
  validation?: Array<{ name: string; status: string }>;
}

function countBySeverity(findings: ReviewFinding[]) {
  return {
    critical: findings.filter((f) => f.severity === 'CRITICAL').length,
    high: findings.filter((f) => f.severity === 'HIGH').length,
    medium: findings.filter((f) => f.severity === 'MEDIUM').length,
    low: findings.filter((f) => f.severity === 'LOW').length,
  };
}

function buildSummaryMessage(review: ReviewJson, prTitle?: string): string {
  const emoji = DECISION_EMOJI[review.decision] ?? '📋';
  const counts = countBySeverity(review.findings);
  const provider = review.provider ? ` (${review.provider})` : '';
  const title = prTitle ? `: ${prTitle}` : '';

  const line1 = `📋 PR #${review.prId}${title}${provider} — ${emoji} ${review.decision}`;
  const line2 = `🔴 ${counts.critical} crit · 🟠 ${counts.high} high · 🟡 ${counts.medium} med · 🟢 ${counts.low} low`;
  const line3 = review.summary;
  const line4 = `📎 Full review → PR-${review.prId}.md`;

  return [line1, line2, '', line3, '', line4].join('\n');
}

function buildMultipart(
  content: string,
  markdownContent: string,
  filename: string,
): { body: string; contentType: string } {
  const boundary = `----discord${Date.now().toString(16)}`;
  const CRLF = '\r\n';

  const payloadPart = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="payload_json"',
    'Content-Type: application/json',
    '',
    JSON.stringify({ content }),
  ].join(CRLF);

  const filePart = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="files[0]"; filename="${filename}"`,
    'Content-Type: text/markdown; charset=utf-8',
    '',
    markdownContent,
  ].join(CRLF);

  const closing = `--${boundary}--`;

  const bodyStr = [payloadPart, filePart, closing].join(CRLF) + CRLF;

  return { body: bodyStr, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function post(
  url: string,
  extraHeaders: Record<string, string>,
  content: string,
  markdownContent?: string,
  filename?: string,
): Promise<void> {
  let headers: Record<string, string>;
  let body: string;

  if (markdownContent && filename) {
    const mp = buildMultipart(content, markdownContent, filename);
    headers = { ...extraHeaders, 'Content-Type': mp.contentType };
    body = mp.body;
  } else {
    headers = { ...extraHeaders, 'Content-Type': 'application/json' };
    body = JSON.stringify({ content });
  }

  const res = await fetch(url, { method: 'POST', headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API failed: ${res.status} ${text}`);
  }
}

export async function sendToDiscord(opts: {
  review: ReviewJson;
  reviewMarkdown?: string;
  prTitle?: string;
  botToken?: string;
  channelId?: string;
  webhookUrl?: string;
}): Promise<void> {
  const { review, reviewMarkdown, prTitle, botToken, channelId, webhookUrl } = opts;
  const content = buildSummaryMessage(review, prTitle);
  const filename = reviewMarkdown ? `PR-${review.prId}.md` : undefined;

  const resolvedToken = botToken ?? process.env.DISCORD_BOT_TOKEN;
  const resolvedChannel = channelId ?? process.env.DISCORD_CHANNEL_ID;
  const resolvedWebhook = webhookUrl ?? process.env.DISCORD_WEBHOOK_URL;

  if (resolvedToken && resolvedChannel) {
    await post(
      `https://discord.com/api/v10/channels/${resolvedChannel}/messages`,
      { Authorization: `Bot ${resolvedToken}` },
      content, reviewMarkdown, filename,
    );
  } else if (resolvedWebhook) {
    await post(resolvedWebhook, {}, content, reviewMarkdown, filename);
  } else {
    throw new Error(
      'Discord destination required — set DISCORD_BOT_TOKEN + DISCORD_CHANNEL_ID, or DISCORD_WEBHOOK_URL in .env',
    );
  }
}

export function registerDiscordTools(server: McpServer) {
  server.tool(
    'send_to_discord',
    'Send a PR review result to Discord. Posts a summary message with severity counts and attaches the full markdown review as a file.',
    {
      review_json: z
        .string()
        .describe('The review result as a JSON string (content of reviews/PR-<id>.json)'),
      review_markdown: z
        .string()
        .optional()
        .describe('Full markdown review content to attach as PR-<id>.md file'),
      pr_title: z.string().optional().describe('PR title shown in the summary message'),
      channel_id: z
        .string()
        .optional()
        .describe('Discord channel ID (bot token mode) — overrides DISCORD_CHANNEL_ID env var'),
      bot_token: z
        .string()
        .optional()
        .describe('Discord bot token — overrides DISCORD_BOT_TOKEN env var'),
      webhook_url: z
        .string()
        .optional()
        .describe('Discord webhook URL — fallback when no bot token configured'),
    },
    async ({ review_json, review_markdown, pr_title, channel_id, bot_token, webhook_url }) => {
      let review: ReviewJson;
      try {
        review = JSON.parse(review_json);
      } catch {
        throw new Error('Invalid JSON in review_json parameter');
      }

      await sendToDiscord({
        review,
        reviewMarkdown: review_markdown,
        prTitle: pr_title,
        botToken: bot_token,
        channelId: channel_id,
        webhookUrl: webhook_url,
      });

      const mode =
        (bot_token ?? process.env.DISCORD_BOT_TOKEN) ? 'bot token' : 'webhook';
      return {
        content: [
          {
            type: 'text' as const,
            text: `ส่งผล review PR #${review.prId} ไปยัง Discord เรียบร้อยแล้ว via ${mode} (decision: ${review.decision})`,
          },
        ],
      };
    },
  );
}
