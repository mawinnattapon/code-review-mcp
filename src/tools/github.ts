import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getOctokit } from '../utils/github.js';

export function registerGithubTools(server: McpServer) {
  server.tool(
    'list_pull_requests',
    'List pull requests in a GitHub repository',
    {
      owner: z.string().describe('Repository owner (username or org)'),
      repo: z.string().describe('Repository name'),
      state: z.enum(['open', 'closed', 'all']).default('open').describe('PR state filter'),
      limit: z.number().min(1).max(100).default(10).describe('Max number of PRs to return'),
    },
    async ({ owner, repo, state, limit }) => {
      const octokit = getOctokit();
      const { data } = await octokit.pulls.list({
        owner,
        repo,
        state,
        per_page: limit,
      });

      const prs = data.map((pr) => ({
        number: pr.number,
        title: pr.title,
        author: pr.user?.login,
        state: pr.state,
        draft: pr.draft,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        url: pr.html_url,
        labels: pr.labels.map((l) => l.name),
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(prs, null, 2) }],
      };
    },
  );

  server.tool(
    'get_pull_request',
    'Get details of a specific pull request including changed files',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository name'),
      pr_number: z.number().describe('Pull request number'),
    },
    async ({ owner, repo, pr_number }) => {
      const octokit = getOctokit();
      const [{ data: pr }, { data: files }] = await Promise.all([
        octokit.pulls.get({ owner, repo, pull_number: pr_number }),
        octokit.pulls.listFiles({ owner, repo, pull_number: pr_number }),
      ]);

      const result = {
        number: pr.number,
        title: pr.title,
        description: pr.body,
        author: pr.user?.login,
        base: pr.base.ref,
        head: pr.head.ref,
        state: pr.state,
        draft: pr.draft,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        url: pr.html_url,
        labels: pr.labels.map((l) => l.name),
        stats: {
          changed_files: pr.changed_files,
          additions: pr.additions,
          deletions: pr.deletions,
          commits: pr.commits,
        },
        files: files.map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          changes: f.changes,
        })),
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    'get_diff',
    'Get the unified diff of a pull request (added lines only, with filenames and line numbers)',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository name'),
      pr_number: z.number().describe('Pull request number'),
    },
    async ({ owner, repo, pr_number }) => {
      const octokit = getOctokit();
      const { data: files } = await octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: pr_number,
      });

      const diffParts = files.map((f) => {
        const header = `--- a/${f.filename}\n+++ b/${f.filename}`;
        const patch = f.patch ?? '(binary file or no patch available)';
        return `${header}\n${patch}`;
      });

      return {
        content: [{ type: 'text' as const, text: diffParts.join('\n\n') }],
      };
    },
  );

  server.tool(
    'get_file_content',
    'Get the content of a file in a GitHub repository',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository name'),
      path: z.string().describe('File path in the repository'),
      ref: z
        .string()
        .optional()
        .describe('Branch, tag, or commit SHA (defaults to default branch)'),
    },
    async ({ owner, repo, path, ref }) => {
      const octokit = getOctokit();
      const { data } = await octokit.repos.getContent({ owner, repo, path, ref });

      if (Array.isArray(data)) {
        const entries = data.map((f) => `${f.type.padEnd(4)} ${f.name}`).join('\n');
        return {
          content: [{ type: 'text' as const, text: `Directory: ${path}\n\n${entries}` }],
        };
      }

      if (data.type !== 'file' || !('content' in data)) {
        return {
          content: [{ type: 'text' as const, text: `Not a file: type=${data.type}` }],
        };
      }

      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      return {
        content: [{ type: 'text' as const, text: content }],
      };
    },
  );
}
