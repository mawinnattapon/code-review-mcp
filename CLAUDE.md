# Code Review MCP — Project Instructions

## ภาษา (Language Rule — MANDATORY)

**ตอบและเขียนทุกอย่างเป็นภาษาไทยเสมอ** ไม่ว่าผู้ใช้จะพิมพ์ภาษาอะไรก็ตาม

ยกเว้นที่ต้องเป็น English:
- code snippets และ file paths
- identifiers, variable names, function names
- severity keywords: CRITICAL, HIGH, MEDIUM, LOW
- decision keywords: APPROVE, REQUEST CHANGES, BLOCK
- status words: Added, Modified, Deleted, Skipped

## Review Output Format (MANDATORY)

เมื่อ review PR ให้แสดงผลตาม structure นี้เสมอ ห้ามเปลี่ยน format หรือตัดส่วนใดออก:

```
# PR Review: #<pr-number>

**Decision**: APPROVE | REQUEST CHANGES | BLOCK

## Summary
<2–3 ประโยคภาษาไทย: PR ทำอะไร + ประเมินภาพรวม>

## Findings

### CRITICAL
<findings หรือ None>

### HIGH
<findings หรือ None>

### MEDIUM
<findings หรือ None>

### LOW
<findings หรือ None>

## Validation Results
| Check | Result |
|---|---|
| Type check | Skipped (not checked out) |
| Lint | Skipped (not checked out) |
| Tests | Skipped (not checked out) |
| Build | Skipped (not checked out) |

## Files Reviewed
<แต่ละไฟล์ พร้อม Added / Modified / Deleted>
```

Finding format (ใช้ทุก finding):
```
- **[Category] `path:line`** — <ปัญหา ระบุค่าจริงจาก diff>
  **ทำไมถึงสำคัญ:** <ผลกระทบถ้าไม่แก้>
  **แนะนำ:** <วิธีแก้ที่เป็นรูปธรรม>
```

## MCP Connector

- Connector name: **agent-reviwe-code**
- GitHub tools: `list_pull_requests`, `get_pull_request`, `get_diff`, `get_file_content`
- CodeCommit tools: `cc_list_pull_requests`, `cc_get_pull_request`, `cc_get_diff`, `cc_get_file`
- Review tools: `review_security`, `review_quality`, `review_license`, `review_code`
