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
  // Strip all mention types: user <@ID>, user+nick <@!ID>, role <@&ID>
  const text = content.replace(/<@[!&]?\d+>/g, '').trim();
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

function log(tag: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${tag}] ${msg}`);
}

async function runReview(message: Message, cmd: ParsedCommand): Promise<void> {
  log('BOT', `Starting review: repo=${cmd.repo} pr=${cmd.prId} provider=${cmd.provider}`);

  const status = await message.reply(
    `⏳ กำลัง review PR #${cmd.prId} จาก \`${cmd.repo}\` (${cmd.provider})...`,
  );
  log('DISCORD', 'Status message sent');

  const prompt = buildPrompt(cmd);
  const hasAwsCreds = prompt.includes('--aws-key');
  log('CLAUDE', `Spawning claude CLI`);
  log('CLAUDE', `Prompt: /review-pr ${cmd.repo} ${cmd.prId} --provider ${cmd.provider} ${hasAwsCreds ? '[+AWS creds]' : '[no AWS creds]'}`);

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    log('CLAUDE', `Process spawned (pid: ${proc.pid})`);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (d: Buffer) => {
      const chunk = d.toString();
      stdout += chunk;
      // Print each line as it arrives
      chunk.split('\n').filter(Boolean).forEach((line) => {
        log('STDOUT', line.slice(0, 200));
      });
    });

    proc.stderr?.on('data', (d: Buffer) => {
      const chunk = d.toString();
      stderr += chunk;
      chunk.split('\n').filter(Boolean).forEach((line) => {
        log('STDERR', line.slice(0, 200));
      });
    });

    proc.on('close', async (code) => {
      log('CLAUDE', `Process exited with code ${code}`);
      if (code !== 0) {
        const errMsg = (stderr || stdout).slice(0, 400) || 'unknown error';
        log('ERROR', errMsg);
        await status.edit(`❌ Review ล้มเหลว (exit ${code}): ${errMsg.slice(0, 200)}`);
        reject(new Error(errMsg));
      } else {
        log('BOT', `Review completed successfully for PR #${cmd.prId}`);
        await status.edit(`✅ Review PR #${cmd.prId} เสร็จแล้ว — ดูผลด้านบนใน channel`);
        resolve();
      }
    });

    proc.on('error', async (err) => {
      log('ERROR', `Failed to spawn process: ${err.message}`);
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

  log('BOT', `Message from ${message.author.username}: ${message.content.slice(0, 100)}`);

  const cmd = parseCommand(message.content, client.user.id);
  log('BOT', `Parsed command: ${JSON.stringify(cmd)}`);

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
