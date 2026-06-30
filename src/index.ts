import 'dotenv/config';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { registerGithubTools } from './tools/github.js';
import { registerReviewTools } from './tools/review.js';
import { registerCodeCommitTools } from './tools/codecommit.js';
import { registerDiscordTools } from './tools/discord.js';
import { registerSessionTools, type SessionStore } from './tools/session.js';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT ?? '3000', 10);

// Active SSE sessions: sessionId -> transport
const sessions = new Map<string, SSEServerTransport>();

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

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'code-review-mcp',
    sessions: sessions.size,
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Code Review MCP Server started`);
  console.log(`  SSE endpoint : http://localhost:${PORT}/sse`);
  console.log(`  Health check : http://localhost:${PORT}/health`);
});
