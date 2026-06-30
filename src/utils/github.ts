import { Octokit } from '@octokit/rest';

let instance: Octokit | null = null;

export function getOctokit(): Octokit {
  if (!instance) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN environment variable is required');
    }
    instance = new Octokit({ auth: token });
  }
  return instance;
}
