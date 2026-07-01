import 'dotenv/config';
import { Client, GatewayIntentBits, Events, type Message } from 'discord.js';
import { spawn } from 'child_process';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

interface ParsedCommand {
  repo: string;
  prId: string;
  provider: 'github' | 'codecommit';
}

// @bot review <repo> <id> [--provider github|codecommit]
function parseCommand(content: string, botId: string): ParsedCommand | null {
  const text = content.replace(new RegExp(`<@!?${botId}>`), '').trim();
  const match = text.match(
    /^review\s+(\S+)\s+(\d+)(?:\s+--provider\s+(github|codecommit))?/i,
  );
  if (!match) return null;
  return {
    repo: match[1],
    prId: match[2],
    provider: (match[3] as 'github' | 'codecommit') ?? 'codecommit',
  };
}

function buildPrompt(cmd: ParsedCommand): string {
  let args = `${cmd.repo} ${cmd.prId} --provider ${cmd.provider}`;

  if (cmd.provider === 'codecommit') {
    const key = process.env.AWS_ACCESS_KEY_ID;
    const secret = process.env.AWS_SECRET_ACCESS_KEY;
    const token = process.env.AWS_SESSION_TOKEN;
    if (key && secret) {
      args += ` --aws-key ${key} --aws-secret ${secret}`;
      if (token) args += ` --aws-token ${token}`;
    }
  }

  return `/review-pr ${args}`;
}

async function runReview(message: Message, cmd: ParsedCommand): Promise<void> {
  const status = await message.reply(
    `⏳ กำลัง review PR #${cmd.prId} จาก \`${cmd.repo}\` (${cmd.provider})...`,
  );

  const prompt = buildPrompt(cmd);

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', async (code) => {
      if (code !== 0) {
        const errMsg = stderr.slice(0, 400) || 'unknown error';
        await status.edit(`❌ Review ล้มเหลว (exit ${code}): ${errMsg}`);
        reject(new Error(errMsg));
      } else {
        await status.edit(`✅ Review PR #${cmd.prId} เสร็จแล้ว — ดูผลด้านบนใน channel`);
        resolve();
      }
    });

    proc.on('error', async (err) => {
      await status.edit(`❌ ไม่สามารถเรียก claude CLI ได้: ${err.message}`);
      reject(err);
    });
  });
}

client.once(Events.ClientReady, (c) => {
  console.log(`Discord bot ready: ${c.user.tag}`);
  console.log(`Listening for @mention in guilds...`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!client.user || !message.mentions.has(client.user.id)) return;

  const cmd = parseCommand(message.content, client.user.id);

  if (!cmd) {
    await message.reply(
      '**รูปแบบคำสั่ง:**\n' +
      '`@bot review <repo> <pr-id>` — CodeCommit (default)\n' +
      '`@bot review <owner/repo> <pr-id> --provider github` — GitHub',
    );
    return;
  }

  try {
    await runReview(message, cmd);
  } catch (err) {
    console.error('Review error:', err);
  }
});

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('DISCORD_BOT_TOKEN is not set in .env');
  process.exit(1);
}

client.login(token);
