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
import { getCodeCommitClient } from '../utils/codecommit.js';
import type { SessionStore } from './session.js';

async function fetchBlob(
  client: ReturnType<typeof getCodeCommitClient>,
  repositoryName: string,
  blobId: string,
): Promise<string> {
  const result = await client.send(new GetBlobCommand({ repositoryName, blobId }));
  return Buffer.from(result.content!).toString('utf-8');
}

export function registerCodeCommitTools(server: McpServer, store: SessionStore = {}) {
  server.tool(
    'cc_list_pull_requests',
    'List pull requests in an AWS CodeCommit repository',
    {
      repositoryName: z.string().describe('CodeCommit repository name'),
      status: z.enum(['OPEN', 'CLOSED']).default('OPEN').describe('PR status filter'),
      limit: z.number().min(1).max(50).default(10).describe('Max number of PRs to return'),
    },
    async ({ repositoryName, status, limit }) => {
      const client = getCodeCommitClient(store.awsCredentials);

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
    },
    async ({ pullRequestId }) => {
      const client = getCodeCommitClient(store.awsCredentials);
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
    },
    async ({ repositoryName, pullRequestId }) => {
      const client = getCodeCommitClient(store.awsCredentials);

      // Resolve source/destination commits from PR
      const { pullRequest } = await client.send(new GetPullRequestCommand({ pullRequestId }));
      const target = pullRequest?.pullRequestTargets?.[0];

      if (!target?.sourceCommit || !target?.destinationCommit) {
        throw new Error('Could not resolve source/destination commits from pull request');
      }

      // Get list of changed files
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
        const changeType = diff.changeType; // 'A' | 'M' | 'D'
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
    },
    async ({ repositoryName, filePath, commitSpecifier }) => {
      const client = getCodeCommitClient(store.awsCredentials);

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
