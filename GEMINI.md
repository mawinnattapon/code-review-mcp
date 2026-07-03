# Code Review MCP — Gemini/Antigravity Instructions

## ภาษา (Language Rule — MANDATORY)

**ตอบและเขียนทุกอย่างเป็นภาษาไทยเสมอ** ไม่ว่าผู้ใช้จะพิมพ์ภาษาอะไรก็ตาม

ยกเว้นที่ต้องเป็น English:
- code snippets และ file paths
- identifiers, variable names, function names
- severity keywords: CRITICAL, HIGH, MEDIUM, LOW
- decision keywords: APPROVE, REQUEST CHANGES, BLOCK
- status words: Added, Modified, Deleted, Skipped

## Code Review (การ review PR — MANDATORY)

เมื่อได้รับคำขอ review PR ให้ทำตามลำดับนี้:

### Step 1 — FETCH
ใช้ tools จาก agent-reviwe-code MCP connector:

**GitHub:** `get_pull_request` → `get_diff` → `review_code`

**CodeCommit:** `cc_get_pull_request` → `cc_get_diff` → `review_code`
พร้อมส่ง `aws_access_key_id`, `aws_secret_access_key`, `aws_session_token` ทุก call

### Step 2 — REVIEW
ตรวจ 7 categories: Correctness, Type Safety, Pattern Compliance, Security, Performance, Completeness, Maintainability

Severity:
- CRITICAL → BLOCK
- HIGH → REQUEST CHANGES
- MEDIUM/LOW → APPROVE (with comments)

### Step 3 — DISCORD NOTIFICATION (ห้ามข้าม)

หลัง review เสร็จทุกครั้ง ให้เรียก `send_to_discord` จาก agent-reviwe-code **อัตโนมัติ** โดยส่ง:
- `review_json`: JSON string ตาม schema นี้
```json
{
  "prId": "<pr-number>",
  "provider": "github | codecommit",
  "decision": "APPROVE | REQUEST CHANGES | BLOCK",
  "summary": "<2-3 ประโยค ภาษาไทย>",
  "findings": [
    { "severity": "CRITICAL|HIGH|MEDIUM|LOW", "category": "...", "description": "...", "location": "path:line" }
  ],
  "validation": [
    { "name": "Type check", "status": "Skipped (not checked out)" },
    { "name": "Lint", "status": "Skipped (not checked out)" },
    { "name": "Tests", "status": "Skipped (not checked out)" },
    { "name": "Build", "status": "Skipped (not checked out)" }
  ]
}
```
- `review_markdown`: สรุป review ทั้งหมดในรูปแบบ Markdown (จะถูกส่งเป็นไฟล์แนบ)
- `pr_title`: ชื่อ PR

## MCP Connector

- Connector name: **agent-reviwe-code**
- GitHub tools: `list_pull_requests`, `get_pull_request`, `get_diff`, `get_file_content`
- CodeCommit tools: `cc_list_pull_requests`, `cc_get_pull_request`, `cc_get_diff`, `cc_get_file`
- Review tools: `review_security`, `review_quality`, `review_license`, `review_code`
- Discord tool: `send_to_discord`
