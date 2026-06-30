import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  ListPullRequestsCommand,
  GetPullRequestCommand,
  GetDifferencesCommand,
  GetBlobCommand,
  GetFileCommand,
} from '@aws-sdk/client-codecommit';
import { createTwoFilesPatch } from 'diff';
import { getCodeCommitClient, type AwsCredentials } from '../utils/codecommit.js';

// Optional inline credential params — each tool accepts these so credentials
// can be passed per-call without relying on server-side session state.
const awsCredentialParams = {
  aws_access_key_id: z
    .string()
    .optional()
    .describe('AWS Access Key ID — overrides server env var'),
  aws_secret_access_key: z
    .string()
    .optional()
    .describe('AWS Secret Access Key — overrides server env var'),
  aws_session_token: z
    .string()
    .optional()
    .describe('AWS Session Token (required for Identity Center / STS credentials)'),
  aws_region: z
    .string()
    .optional()
    .describe('AWS region (default: ap-southeast-1 or AWS_REGION env var)'),
};

function resolveCredentials(params: {
  aws_access_key_id?: string;
  aws_secret_access_key?: string;
  aws_session_token?: string;
  aws_region?: string;
}): AwsCredentials | undefined {
  if (params.aws_access_key_id && params.aws_secret_access_key) {
    return {
      accessKeyId: params.aws_access_key_id,
      secretAccessKey: params.aws_secret_access_key,
      sessionToken: params.aws_session_token,
      region:
        params.aws_region ?? process.env.AWS_REGION ?? 'ap-southeast-1',
    };
  }
  return undefined;
}

async function fetchBlob(
  client: ReturnType<typeof getCodeCommitClient>,
  repositoryName: string,
  blobId: string,
): Promise<string> {
  const result = await client.send(new GetBlobCommand({ repositoryName, blobId }));
  return Buffer.from(result.content!).toString('utf-8');
}

export function registerCodeCommitTools(server: McpServer) {
  server.tool(
    'cc_list_pull_requests',
    'List pull requests in an AWS CodeCommit repository',
    {
      repositoryName: z.string().describe('CodeCommit repository name'),
      status: z.enum(['OPEN', 'CLOSED']).default('OPEN').describe('PR status filter'),
      limit: z.number().min(1).max(50).default(10).describe('Max number of PRs to return'),
      ...awsCredentialParams,
    },
    async ({ repositoryName, status, limit, ...creds }) => {
      const client = getCodeCommitClient(resolveCredentials(creds));

      const listResult = await client.send(
        new ListPullRequestsCommand({
          repositoryName,
          pullRequestStatus: status,
          maxResults: limit,
        }),
      );

      const ids = (listResult.pullRequestIds ?? []).slice(0, limit);

      const prs = await Promise.all(
        ids.map(async (pullRequestId) => {
          const { pullRequest: pr } = await client.send(
            new GetPullRequestCommand({ pullRequestId }),
          );
          const target = pr?.pullRequestTargets?.[0];
          return {
            pullRequestId,
            title: pr?.title,
            status: pr?.pullRequestStatus,
            authorArn: pr?.authorArn,
            creationDate: pr?.creationDate,
            lastActivityDate: pr?.lastActivityDate,
            sourceReference: target?.sourceReference,
            destinationReference: target?.destinationReference,
            repositoryName: target?.repositoryName,
          };
        }),
      );

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(prs, null, 2) }],
      };
    },
  );

  server.tool(
    'cc_get_pull_request',
    'Get details of a specific AWS CodeCommit pull request',
    {
      pullRequestId: z.string().describe('Pull request ID (numeric string, e.g. "42")'),
      ...awsCredentialParams,
    },
    async ({ pullRequestId, ...creds }) => {
      const client = getCodeCommitClient(resolveCredentials(creds));
      const { pullRequest } = await client.send(new GetPullRequestCommand({ pullRequestId }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(pullRequest, null, 2) }],
      };
    },
  );

  server.tool(
    'cc_get_diff',
    'Get unified diff of an AWS CodeCommit pull request (fetches blobs and constructs patch)',
    {
      repositoryName: z.string().describe('CodeCommit repository name'),
      pullRequestId: z.string().describe('Pull request ID'),
      ...awsCredentialParams,
    },
    async ({ repositoryName, pullRequestId, ...creds }) => {
      const client = getCodeCommitClient(resolveCredentials(creds));

      const { pullRequest } = await client.send(new GetPullRequestCommand({ pullRequestId }));
      const target = pullRequest?.pullRequestTargets?.[0];

      if (!target?.sourceCommit || !target?.destinationCommit) {
        throw new Error('Could not resolve source/destination commits from pull request');
      }

      const diffsResult = await client.send(
        new GetDifferencesCommand({
          repositoryName,
          beforeCommitSpecifier: target.destinationCommit,
          afterCommitSpecifier: target.sourceCommit,
        }),
      );

      const differences = diffsResult.differences ?? [];
      const diffParts: string[] = [];

      for (const diff of differences) {
        const changeType = diff.changeType;
        const filePath = diff.afterBlob?.path ?? diff.beforeBlob?.path ?? 'unknown';

        let beforeContent = '';
        let afterContent = '';

        if (diff.beforeBlob?.blobId && changeType !== 'A') {
          beforeContent = await fetchBlob(client, repositoryName, diff.beforeBlob.blobId);
        }

        if (diff.afterBlob?.blobId && changeType !== 'D') {
          afterContent = await fetchBlob(client, repositoryName, diff.afterBlob.blobId);
        }

        const patch = createTwoFilesPatch(
          changeType === 'A' ? '/dev/null' : `a/${filePath}`,
          changeType === 'D' ? '/dev/null' : `b/${filePath}`,
          beforeContent,
          afterContent,
          '',
          '',
          { context: 3 },
        );

        diffParts.push(patch);
      }

      return {
        content: [{ type: 'text' as const, text: diffParts.join('\n') }],
      };
    },
  );

  server.tool(
    'cc_get_file',
    'Get the content of a file in an AWS CodeCommit repository',
    {
      repositoryName: z.string().describe('CodeCommit repository name'),
      filePath: z.string().describe('File path in the repository'),
      commitSpecifier: z
        .string()
        .optional()
        .describe('Branch name, tag, or commit ID (defaults to HEAD)'),
      ...awsCredentialParams,
    },
    async ({ repositoryName, filePath, commitSpecifier, ...creds }) => {
      const client = getCodeCommitClient(resolveCredentials(creds));

      const result = await client.send(
        new GetFileCommand({ repositoryName, filePath, commitSpecifier }),
      );

      const content = Buffer.from(result.fileContent!).toString('utf-8');
      return {
        content: [{ type: 'text' as const, text: content }],
      };
    },
  );
}
