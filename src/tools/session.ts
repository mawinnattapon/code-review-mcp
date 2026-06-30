import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AwsCredentials } from '../utils/codecommit.js';

export interface SessionStore {
  awsCredentials?: AwsCredentials;
}

export function registerSessionTools(server: McpServer, store: SessionStore) {
  server.tool(
    'set_aws_credentials',
    'Set AWS credentials for this session. Required when using CodeCommit tools without server-level env vars. Use your own IAM or Identity Center credentials — they are scoped to this session only.',
    {
      access_key_id: z.string().describe('AWS Access Key ID (AKIA... or ASIA...)'),
      secret_access_key: z.string().describe('AWS Secret Access Key'),
      session_token: z
        .string()
        .optional()
        .describe('AWS Session Token — required for temporary credentials (ASIA prefix)'),
      region: z
        .string()
        .default('ap-southeast-1')
        .describe('AWS region of your CodeCommit repositories'),
    },
    async ({ access_key_id, secret_access_key, session_token, region }) => {
      store.awsCredentials = {
        accessKeyId: access_key_id,
        secretAccessKey: secret_access_key,
        sessionToken: session_token,
        region,
      };

      const keyType = access_key_id.startsWith('ASIA') ? 'temporary (STS)' : 'long-term (IAM)';
      return {
        content: [
          {
            type: 'text' as const,
            text: `AWS credentials set for this session\nKey type: ${keyType}\nRegion: ${region}\n\nพร้อมใช้ cc_* tools แล้ว (credentials จะหมดอายุเมื่อปิด session นี้)`,
          },
        ],
      };
    },
  );

  server.tool(
    'clear_aws_credentials',
    'Clear AWS credentials from this session (revert to server env vars)',
    {},
    async () => {
      store.awsCredentials = undefined;
      return {
        content: [
          {
            type: 'text' as const,
            text: 'AWS session credentials cleared — will fall back to server env vars',
          },
        ],
      };
    },
  );
}
