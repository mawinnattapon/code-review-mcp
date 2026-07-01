import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const DECISION_COLOR: Record<string, number> = {
  APPROVE: 0x57f287,          // green
  'REQUEST CHANGES': 0xfee75c, // yellow
  BLOCK: 0xed4245,             // red
};

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

const SEVERITY_GROUPS = [
  { key: 'CRITICAL', icon: '🔴' },
  { key: 'HIGH',     icon: '🟠' },
  { key: 'MEDIUM',   icon: '🟡' },
  { key: 'LOW',      icon: '🔵' },
] as const;

function buildFindingLine(f: ReviewFinding): string {
  const loc = f.location ? ` \`${f.location}\`` : '';
  // Truncate description to keep each line readable in Discord
  const desc = f.description.length > 180 ? f.description.slice(0, 180) + '…' : f.description;
  return `**[${f.category}]**${loc} — ${desc}`;
}

function buildEmbed(review: ReviewJson, prTitle?: string) {
  const counts = countBySeverity(review.findings);
  const emoji = DECISION_EMOJI[review.decision] ?? '📋';
  const color = DECISION_COLOR[review.decision] ?? 0x99aab5;
  const provider = review.provider ? ` (${review.provider})` : '';

  // Summary counts as inline fields
  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    { name: '🔴 CRITICAL', value: String(counts.critical), inline: true },
    { name: '🟠 HIGH',     value: String(counts.high),     inline: true },
    { name: '🟡 MEDIUM',   value: String(counts.medium),   inline: true },
    { name: '🔵 LOW',      value: String(counts.low),      inline: true },
  ];

  // Group findings by severity — each group becomes one field
  for (const { key, icon } of SEVERITY_GROUPS) {
    const group = review.findings.filter((f) => f.severity === key);
    if (group.length === 0) continue;

    // Build bullet list; keep total field value under Discord's 1024-char limit
    const lines: string[] = [];
    let total = 0;
    for (const f of group) {
      const line = `• ${buildFindingLine(f)}`;
      if (total + line.length + 1 > 1020) {
        lines.push(`_…และอีก ${group.length - lines.length} รายการ_`);
        break;
      }
      lines.push(line);
      total += line.length + 1;
    }

    fields.push({
      name: `${icon} ${key} (${group.length})`,
      value: lines.join('\n'),
      inline: false,
    });
  }

  return {
    title: `${emoji} PR #${review.prId}${prTitle ? `: ${prTitle}` : ''}${provider}`,
    description: `**Decision: ${review.decision}**\n\n${review.summary}`,
    color,
    fields,
    footer: { text: 'Code Review MCP' },
    timestamp: new Date().toISOString(),
  };
}

async function postViaWebhook(url: string, payload: object): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord webhook failed: ${res.status} ${body}`);
  }
}

async function postViaBot(token: string, channelId: string, payload: object): Promise<void> {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord bot API failed: ${res.status} ${body}`);
  }
}

export function registerDiscordTools(server: McpServer) {
  server.tool(
    'send_to_discord',
    'Send a PR review result to Discord via bot token or webhook. Supports both modes — bot token is preferred when available.',
    {
      review_json: z
        .string()
        .describe('The review result as a JSON string (content of reviews/PR-<id>.json)'),
      pr_title: z.string().optional().describe('PR title for the Discord embed header'),
      channel_id: z
        .string()
        .optional()
        .describe('Discord channel ID to send the message (bot token mode) — overrides DISCORD_CHANNEL_ID env var'),
      bot_token: z
        .string()
        .optional()
        .describe('Discord bot token (overrides DISCORD_BOT_TOKEN env var)'),
      webhook_url: z
        .string()
        .optional()
        .describe('Discord webhook URL — fallback if no bot token (overrides DISCORD_WEBHOOK_URL env var)'),
    },
    async ({ review_json, pr_title, channel_id, bot_token, webhook_url }) => {
      let review: ReviewJson;
      try {
        review = JSON.parse(review_json);
      } catch {
        throw new Error('Invalid JSON in review_json parameter');
      }

      const payload = { embeds: [buildEmbed(review, pr_title)] };

      const resolvedToken = bot_token ?? process.env.DISCORD_BOT_TOKEN;
      const resolvedChannel = channel_id ?? process.env.DISCORD_CHANNEL_ID;
      const resolvedWebhook = webhook_url ?? process.env.DISCORD_WEBHOOK_URL;

      if (resolvedToken && resolvedChannel) {
        await postViaBot(resolvedToken, resolvedChannel, payload);
      } else if (resolvedWebhook) {
        await postViaWebhook(resolvedWebhook, payload);
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
