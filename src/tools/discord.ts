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

async function postViaBot(
  token: string,
  channelId: string,
  content: string,
  markdownContent?: string,
  filename?: string,
): Promise<void> {
  const url = `https://discord.com/api/v10/channels/${channelId}/messages`;

  if (markdownContent && filename) {
    // Send with file attachment via multipart/form-data
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content }));
    form.append(
      'files[0]',
      new Blob([markdownContent], { type: 'text/markdown' }),
      filename,
    );

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Discord bot API failed: ${res.status} ${body}`);
    }
  } else {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Discord bot API failed: ${res.status} ${body}`);
    }
  }
}

async function postViaWebhook(
  webhookUrl: string,
  content: string,
  markdownContent?: string,
  filename?: string,
): Promise<void> {
  if (markdownContent && filename) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content }));
    form.append(
      'files[0]',
      new Blob([markdownContent], { type: 'text/markdown' }),
      filename,
    );

    const res = await fetch(webhookUrl, { method: 'POST', body: form });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Discord webhook failed: ${res.status} ${body}`);
    }
  } else {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Discord webhook failed: ${res.status} ${body}`);
    }
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

      const content = buildSummaryMessage(review, pr_title);
      const filename = review_markdown ? `PR-${review.prId}.md` : undefined;

      const resolvedToken = bot_token ?? process.env.DISCORD_BOT_TOKEN;
      const resolvedChannel = channel_id ?? process.env.DISCORD_CHANNEL_ID;
      const resolvedWebhook = webhook_url ?? process.env.DISCORD_WEBHOOK_URL;

      if (resolvedToken && resolvedChannel) {
        await postViaBot(resolvedToken, resolvedChannel, content, review_markdown, filename);
      } else if (resolvedWebhook) {
        await postViaWebhook(resolvedWebhook, content, review_markdown, filename);
      } else {
        throw new Error(
          'Discord destination required — set DISCORD_BOT_TOKEN + DISCORD_CHANNEL_ID, or DISCORD_WEBHOOK_URL in .env',
        );
      }

      const mode = resolvedToken && resolvedChannel ? 'bot token' : 'webhook';
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
