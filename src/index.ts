import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { registerGithubTools } from './tools/github.js';
import { registerReviewTools } from './tools/review.js';
import { registerCodeCommitTools } from './tools/codecommit.js';
import { registerDiscordTools, sendToDiscord } from './tools/discord.js';
import { registerSessionTools, type SessionStore } from './tools/session.js';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT ?? '3000', 10);

// Active SSE sessions: sessionId -> transport
const sessions = new Map<string, SSEServerTransport>();

// Active Streamable HTTP sessions: sessionId -> { transport, server }
const httpSessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'code-review-mcp',
    version: '1.0.0',
  });

  // Per-session credential store shared across tool registrations
  const store: SessionStore = {};

  registerSessionTools(server, store);
  registerGithubTools(server);
  registerReviewTools(server);
  registerCodeCommitTools(server);
  registerDiscordTools(server);
  return server;
}

// SSE endpoint — MCP client connects here
app.get('/sse', async (_req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  const server = createMcpServer();

  sessions.set(transport.sessionId, transport);
  res.on('close', () => sessions.delete(transport.sessionId));

  await server.connect(transport);
});

// Message endpoint — MCP client posts messages here
app.post('/messages', async (req, res) => {
  const sessionId = req.query['sessionId'] as string;
  const transport = sessions.get(sessionId);

  if (!transport) {
    res.status(404).json({ error: 'Session not found', sessionId });
    return;
  }

  await transport.handlePostMessage(req, res, req.body);
});

// Streamable HTTP endpoint — for Google Antigravity CLI and HTTP-first MCP clients
// POST /mcp handles initialize (creates session) and all subsequent requests
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const existing = sessionId ? httpSessions.get(sessionId) : undefined;

  if (existing) {
    // Reuse existing session
    await existing.transport.handleRequest(req, res, req.body);
    return;
  }

  // Only initialize requests may create a new session
  if (!isInitializeRequest(req.body)) {
    res.status(400).json({ error: 'No active session — send initialize request first' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      httpSessions.set(id, { transport, server });
    },
  });

  const server = createMcpServer();

  transport.onclose = () => {
    if (transport.sessionId) httpSessions.delete(transport.sessionId);
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// GET /mcp — server-to-client SSE stream within a Streamable HTTP session
app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const existing = sessionId ? httpSessions.get(sessionId) : undefined;

  if (!existing) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  await existing.transport.handleRequest(req, res);
});

// DELETE /mcp — tear down a Streamable HTTP session
app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const existing = sessionId ? httpSessions.get(sessionId) : undefined;

  if (!existing) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  await existing.transport.handleRequest(req, res);
});

// Test Discord endpoint — POST /test/discord
app.post('/test/discord', async (req, res) => {
  try {
    const { review_markdown, bot_token, webhook_url, channel_id } = req.body ?? {};

    const testReview = {
      prId: '0',
      provider: 'test',
      decision: 'APPROVE',
      summary: 'นี่คือ test message จาก Code Review MCP Server — Discord integration ทำงานถูกต้อง',
      findings: [
        { severity: 'MEDIUM', category: 'Test', description: 'ตัวอย่าง MEDIUM finding', location: 'src/test.ts:1' },
        { severity: 'LOW',    category: 'Test', description: 'ตัวอย่าง LOW finding',    location: 'src/test.ts:2' },
      ],
      validation: [
        { name: 'Type check', status: 'Skipped (not checked out)' },
        { name: 'Lint',       status: 'Skipped (not checked out)' },
        { name: 'Tests',      status: 'Skipped (not checked out)' },
        { name: 'Build',      status: 'Skipped (not checked out)' },
      ],
    };

    const markdown = review_markdown ?? `# PR Review: #0 (Test)\n\n**Decision**: APPROVE\n\n## Summary\nTest message from Code Review MCP\n`;

    await sendToDiscord({
      review: testReview,
      reviewMarkdown: markdown,
      prTitle: 'Test Message',
      botToken: bot_token,
      channelId: channel_id,
      webhookUrl: webhook_url,
    });

    res.json({ ok: true, message: 'ส่ง test message ไปยัง Discord เรียบร้อยแล้ว' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
});

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'code-review-mcp',
    sessions: { sse: sessions.size, http: httpSessions.size },
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Code Review MCP Server started`);
  console.log(`  SSE endpoint         : http://localhost:${PORT}/sse`);
  console.log(`  Streamable HTTP      : http://localhost:${PORT}/mcp`);
  console.log(`  Health check         : http://localhost:${PORT}/health`);
});
