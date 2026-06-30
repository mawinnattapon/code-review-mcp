# Code Review MCP Server

MCP (Model Context Protocol) Server สำหรับ automated code review ผ่าน GitHub

## Tools

| Tool | Description |
|------|-------------|
| `list_pull_requests` | แสดงรายการ PRs ใน repo |
| `get_pull_request` | ดึงรายละเอียดและไฟล์ที่เปลี่ยนใน PR |
| `get_diff` | ดึง unified diff ของ PR |
| `get_file_content` | ดึงเนื้อหาไฟล์ใน repo |
| `review_security` | ตรวจ security issues (injection, XSS, secrets, weak crypto) |
| `review_quality` | ตรวจ quality issues (debug code, error handling, type safety) |
| `review_license` | ตรวจ license headers และ dependency changes |
| `review_code` | รัน security + quality รวมในครั้งเดียว |

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env file
cp .env.example .env

# 3. Add your GitHub token to .env
GITHUB_TOKEN=ghp_your_token_here
```

## Running locally (dev)

```bash
npm run dev
# Server runs at http://localhost:3000
```

## Build & run

```bash
npm run build
npm start
```

## Deploy to Render

1. Push code to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect repository
4. Render auto-detects `render.yaml`
5. Set `GITHUB_TOKEN` in Environment Variables
6. Deploy

## Deploy to Railway

1. Push code to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
3. Set `GITHUB_TOKEN` in Variables tab
4. Railway auto-builds and deploys

## MCP Client configuration

Add to your MCP client config (e.g., Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "code-review": {
      "url": "https://your-deployed-url.onrender.com/sse"
    }
  }
}
```

For local dev:
```json
{
  "mcpServers": {
    "code-review": {
      "url": "http://localhost:3000/sse"
    }
  }
}
```

## GitHub Token

สร้าง token ที่ GitHub → Settings → Developer settings → Personal access tokens

Permissions ที่ต้องการ:
- `repo` (read access to code, pull requests)
