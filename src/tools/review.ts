import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getOctokit } from '../utils/github.js';

// --- Types ---

interface Finding {
  line: number;
  filename: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  message: string;
  snippet: string;
}

interface Rule {
  pattern: RegExp;
  severity: Finding['severity'];
  category: string;
  message: string;
}

// --- Diff parser ---

function extractAddedLines(
  diff: string,
): Array<{ lineNum: number; content: string; filename: string }> {
  const lines: Array<{ lineNum: number; content: string; filename: string }> = [];
  let currentFile = '';
  let currentLineNum = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6);
    } else if (line.startsWith('@@')) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      if (match) currentLineNum = parseInt(match[1], 10) - 1;
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      currentLineNum++;
      lines.push({ lineNum: currentLineNum, content: line.slice(1), filename: currentFile });
    } else if (!line.startsWith('-')) {
      currentLineNum++;
    }
  }

  return lines;
}

// --- Rules ---

const SECURITY_RULES: Rule[] = [
  {
    pattern:
      /(?:password|passwd|secret|api[_-]?key|auth[_-]?token|private[_-]?key)\s*[=:]\s*['"][^'"]{6,}['"]/i,
    severity: 'critical',
    category: 'Hardcoded Secret',
    message: 'Possible hardcoded credential or secret — use environment variables instead',
  },
  {
    pattern: /\beval\s*\(/,
    severity: 'high',
    category: 'Code Injection',
    message: 'eval() is dangerous and can lead to code injection attacks',
  },
  {
    pattern: /innerHTML\s*=/,
    severity: 'high',
    category: 'XSS',
    message: 'Setting innerHTML with untrusted data can cause XSS — use textContent or sanitize input',
  },
  {
    pattern: /document\.write\s*\(/,
    severity: 'high',
    category: 'XSS',
    message: 'document.write() with dynamic content can introduce XSS vulnerabilities',
  },
  {
    pattern: /\bexec\s*\(|child_process\.exec/,
    severity: 'high',
    category: 'Command Injection',
    message: 'Dynamic command execution — validate and sanitize all inputs',
  },
  {
    pattern: /shell\s*:\s*true/i,
    severity: 'high',
    category: 'Command Injection',
    message: 'shell: true in child_process enables command injection via shell metacharacters',
  },
  {
    pattern: /SELECT\s+.+\s+WHERE\s+.+\+|INSERT\s+.+VALUES\s*\(.+\+/i,
    severity: 'critical',
    category: 'SQL Injection',
    message: 'Potential SQL injection via string concatenation — use parameterized queries',
  },
  {
    pattern: /console\.\w+\s*\(.*(?:password|token|secret|key|auth)/i,
    severity: 'medium',
    category: 'Sensitive Data Exposure',
    message: 'Logging potentially sensitive data to console',
  },
  {
    pattern: /Math\.random\s*\(\s*\)/,
    severity: 'low',
    category: 'Weak Randomness',
    message: 'Math.random() is not cryptographically secure — use crypto.randomBytes() for security',
  },
  {
    pattern: /\b(?:md5|sha1)\s*\(/i,
    severity: 'medium',
    category: 'Weak Cryptography',
    message: 'MD5/SHA1 are cryptographically broken — use SHA-256 or stronger',
  },
  {
    pattern: /http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/,
    severity: 'low',
    category: 'Insecure Protocol',
    message: 'Using HTTP instead of HTTPS — data transmitted in plaintext',
  },
  {
    pattern: /\.\.[\\/]/,
    severity: 'medium',
    category: 'Path Traversal',
    message: 'Potential path traversal — validate and sanitize file paths',
  },
];

const QUALITY_RULES: Rule[] = [
  {
    pattern: /\/\/\s*(?:TODO|FIXME|HACK|XXX|BUG)\b/i,
    severity: 'low',
    category: 'Technical Debt',
    message: 'TODO/FIXME/HACK found — track in issue tracker instead of code comments',
  },
  {
    pattern: /\bconsole\.(log|debug|info)\s*\(/,
    severity: 'low',
    category: 'Debug Code',
    message: 'console.log/debug/info left in code — remove before merging',
  },
  {
    pattern: /\bdebugger\b/,
    severity: 'medium',
    category: 'Debug Code',
    message: 'debugger statement must be removed before merging',
  },
  {
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/,
    severity: 'high',
    category: 'Error Handling',
    message: 'Empty catch block silently swallows errors — add error handling or logging',
  },
  {
    pattern: /:\s*any\b/,
    severity: 'low',
    category: 'Type Safety',
    message: 'TypeScript "any" type disables type checking — use a specific type',
  },
  {
    pattern: /@ts-ignore/,
    severity: 'medium',
    category: 'Type Safety',
    message: '@ts-ignore suppresses TypeScript errors — fix the underlying issue instead',
  },
  {
    pattern: /@ts-nocheck/,
    severity: 'high',
    category: 'Type Safety',
    message: '@ts-nocheck disables TypeScript for the entire file',
  },
  {
    pattern: /\/\/\s*eslint-disable(?!-next)/,
    severity: 'low',
    category: 'Lint Suppression',
    message: 'ESLint rule disabled for entire file/block — prefer eslint-disable-next-line',
  },
];

const LICENSE_HEADER_PATTERNS = [
  /SPDX-License-Identifier:/i,
  /Copyright\s+(?:\(c\)\s+)?\d{4}/i,
  /Licensed under/i,
  /Permission is hereby granted/i,
];

// --- Helpers ---

function runRules(
  addedLines: Array<{ lineNum: number; content: string; filename: string }>,
  rules: Rule[],
): Finding[] {
  const findings: Finding[] = [];

  for (const { lineNum, content, filename } of addedLines) {
    for (const rule of rules) {
      const re = new RegExp(rule.pattern.source, rule.pattern.flags);
      if (re.test(content)) {
        findings.push({
          line: lineNum,
          filename,
          severity: rule.severity,
          category: rule.category,
          message: rule.message,
          snippet: content.trim().slice(0, 120),
        });
      }
    }
  }

  return findings;
}

function formatFindings(findings: Finding[], title: string): string {
  if (findings.length === 0) {
    return `## ${title}\n\nNo automated issues found.`;
  }

  const order: Finding['severity'][] = ['critical', 'high', 'medium', 'low', 'info'];
  const icon: Record<Finding['severity'], string> = {
    critical: '[CRITICAL]',
    high: '[HIGH]',
    medium: '[MEDIUM]',
    low: '[LOW]',
    info: '[INFO]',
  };

  const grouped = findings.reduce(
    (acc, f) => {
      (acc[f.severity] ??= []).push(f);
      return acc;
    },
    {} as Partial<Record<Finding['severity'], Finding[]>>,
  );

  const lines: string[] = [`## ${title}`, ``, `Found ${findings.length} issue(s):`];

  for (const sev of order) {
    const group = grouped[sev];
    if (!group) continue;
    lines.push(``, `### ${icon[sev]} ${sev.toUpperCase()} (${group.length})`);
    for (const f of group) {
      lines.push(`- **[${f.category}]** ${f.message}`);
      lines.push(`  File: \`${f.filename}\` line ${f.line}`);
      lines.push(`  Code: \`${f.snippet}\``);
    }
  }

  return lines.join('\n');
}

// --- Tool registration ---

export function registerReviewTools(server: McpServer) {
  server.tool(
    'review_security',
    'Scan a code diff for security vulnerabilities: injections, XSS, hardcoded secrets, weak crypto, insecure protocols, etc.',
    {
      diff: z.string().describe('Unified diff output to analyze (from get_diff tool)'),
    },
    async ({ diff }) => {
      const addedLines = extractAddedLines(diff);
      const findings = runRules(addedLines, SECURITY_RULES);
      const text = formatFindings(findings, 'Security Review');
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'review_quality',
    'Scan a code diff for quality issues: debug code, empty catch blocks, type safety suppression, technical debt markers',
    {
      diff: z.string().describe('Unified diff output to analyze (from get_diff tool)'),
    },
    async ({ diff }) => {
      const addedLines = extractAddedLines(diff);
      const findings = runRules(addedLines, QUALITY_RULES);
      const text = formatFindings(findings, 'Code Quality Review');
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'review_license',
    'Check license headers on new files and flag dependency file changes in a PR that require manual license review',
    {
      owner: z.string().describe('Repository owner'),
      repo: z.string().describe('Repository name'),
      pr_number: z.number().describe('Pull request number'),
    },
    async ({ owner, repo, pr_number }) => {
      const octokit = getOctokit();
      const results: string[] = ['## License Review', ''];

      // Check repo has a LICENSE file
      try {
        const { data: license } = await octokit.licenses.getForRepo({ owner, repo });
        results.push(`[OK] Repository license: ${license.license?.name ?? 'found'}`);
      } catch {
        results.push('[WARN] No LICENSE file detected in repository root');
      }

      const { data: files } = await octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: pr_number,
      });

      // Check new source files for license headers
      const newSourceFiles = files.filter(
        (f) =>
          f.status === 'added' &&
          /\.(ts|tsx|js|jsx|py|go|java|rb|rs|c|cpp|h|cs|php|swift|kt)$/.test(f.filename),
      );

      if (newSourceFiles.length > 0) {
        results.push('', `Checking ${newSourceFiles.length} new source file(s) for license headers...`);

        const missingHeader: string[] = [];

        for (const file of newSourceFiles) {
          try {
            const { data } = await octokit.repos.getContent({
              owner,
              repo,
              path: file.filename,
              ref: `refs/pull/${pr_number}/head`,
            });

            if (!Array.isArray(data) && data.type === 'file' && 'content' in data) {
              const content = Buffer.from(data.content, 'base64').toString('utf-8');
              const header = content.split('\n').slice(0, 10).join('\n');
              const hasHeader = LICENSE_HEADER_PATTERNS.some((p) => p.test(header));
              if (!hasHeader) missingHeader.push(file.filename);
            }
          } catch {
            // skip unreadable files
          }
        }

        if (missingHeader.length === 0) {
          results.push('[OK] All new source files have license headers');
        } else {
          results.push(`[WARN] ${missingHeader.length} new file(s) missing license header:`);
          missingHeader.forEach((f) => results.push(`  - ${f}`));
        }
      }

      // Flag dependency file changes
      const DEP_FILES = ['package.json', 'requirements.txt', 'go.mod', 'Gemfile', 'Cargo.toml', 'pom.xml', 'pyproject.toml'];
      const changedDeps = files.filter((f) =>
        DEP_FILES.includes(f.filename.split('/').pop() ?? ''),
      );

      if (changedDeps.length > 0) {
        results.push('', '[ACTION REQUIRED] Dependency files changed — manual license review needed:');
        changedDeps.forEach((f) =>
          results.push(`  - ${f.filename}  (+${f.additions} / -${f.deletions} lines)`),
        );
        results.push('  Verify new dependencies have licenses compatible with your project.');
      }

      return { content: [{ type: 'text' as const, text: results.join('\n') }] };
    },
  );

  server.tool(
    'review_code',
    'Run a full automated review on a diff combining security + quality checks and return a structured summary',
    {
      diff: z.string().describe('Unified diff output to analyze (from get_diff tool)'),
    },
    async ({ diff }) => {
      const addedLines = extractAddedLines(diff);
      const secFindings = runRules(addedLines, SECURITY_RULES);
      const qualFindings = runRules(addedLines, QUALITY_RULES);
      const total = secFindings.length + qualFindings.length;

      const lines = [
        '# Automated Code Review',
        '',
        `Lines analyzed : ${addedLines.length} added lines`,
        `Total issues   : ${total} (${secFindings.length} security, ${qualFindings.length} quality)`,
        '',
        formatFindings(secFindings, 'Security'),
        '',
        formatFindings(qualFindings, 'Quality'),
      ];

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
