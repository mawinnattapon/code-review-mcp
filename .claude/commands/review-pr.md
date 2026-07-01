---
description: Review a GitHub or AWS CodeCommit PR using the 7-category rubric. Saves report to reviews/PR-<id>.md and reviews/PR-<id>.json.
argument-hint: <owner/repo> <pr-number> [--provider github|codecommit]
allowed-tools: Bash(mkdir:), Read, Write, Glob
---
Review PR $ARGUMENTS

**กฎภาษา (บังคับ):** ตอบและเขียนทุกอย่างเป็น**ภาษาไทย**เท่านั้น ยกเว้น code snippets, file paths, identifiers, และ keywords ต่อไปนี้ที่ให้เป็น English: CRITICAL, HIGH, MEDIUM, LOW, APPROVE, REQUEST CHANGES, BLOCK, Added, Modified, Deleted, Skipped

ใช้ MCP connector (mawin-agent) ดึงข้อมูลแล้ว review ตาม rubric ด้านล่าง

---

## Step 0 — PARSE ARGUMENTS

แยก argument จาก `$ARGUMENTS`:
- ถ้ามี `--provider codecommit` → provider = `codecommit`, ตัดออกจาก args
- ถ้าไม่มี flag → provider = `github` (default)

**GitHub:** argument คือ `<owner/repo> <pr-number>`
- repo = ส่วนแรก (เช่น `madee-house/backend-api`)
- pr_number = ส่วนที่สอง (เช่น `262`)

**CodeCommit:** argument คือ `<repositoryName> <pullRequestId>`
- repositoryName = ส่วนแรก (เช่น `my-backend-repo`)
- pullRequestId = ส่วนที่สอง (เช่น `"5"`)

---

## Step 0.5 — AWS CREDENTIALS (CodeCommit เท่านั้น)

ถ้า provider = **codecommit**: ขอ AWS credentials จากผู้ใช้ก่อนดำเนินการต่อ

พิมพ์ข้อความนี้ให้ผู้ใช้:
> กรุณาแนบ AWS credentials สำหรับ session นี้ (จาก AWS Access Portal หรือ Identity Center):
> - `AWS_ACCESS_KEY_ID` (ASIA... หรือ AKIA...)
> - `AWS_SECRET_ACCESS_KEY`
> - `AWS_SESSION_TOKEN` (ถ้ามี — สำหรับ temporary credentials)

เก็บค่าที่ได้ไว้เป็น `$AWS_KEY`, `$AWS_SECRET`, `$AWS_TOKEN` สำหรับใช้ใน Step 1

---

## Step 1 — FETCH

ถ้า provider = **github**: เรียก tools ผ่าน mawin-agent connector:
1. `get_pull_request` (owner, repo, pr_number) → title, description, branch, labels, stats, files
2. `get_diff` (owner, repo, pr_number) → unified diff
3. `review_code` (diff) → automated static analysis

ถ้า provider = **codecommit**: เรียก tools ผ่าน mawin-agent connector พร้อมส่ง credentials ทุก call:
1. `cc_get_pull_request` (pullRequestId, aws_access_key_id=$AWS_KEY, aws_secret_access_key=$AWS_SECRET, aws_session_token=$AWS_TOKEN)
2. `cc_get_diff` (repositoryName, pullRequestId, aws_access_key_id=$AWS_KEY, aws_secret_access_key=$AWS_SECRET, aws_session_token=$AWS_TOKEN)
3. `review_code` (diff) → automated static analysis (ไม่ต้องส่ง credentials)

ถ้า tool ใดล้มเหลว ให้หยุดและรายงาน error ทันที อย่าเดาผลลัพธ์

---

## Step 2 — CONTEXT

อ่าน PR title, description, branch name เพื่อทำความเข้าใจ intent ของ PR ก่อน review

---

## Step 3 — REVIEW

Review diff ของแต่ละไฟล์อย่างละเอียด ตรวจ 7 categories:

| Category | สิ่งที่ตรวจ |
|---|---|
| Correctness | Logic errors, off-by-ones, null/undefined, edge cases, race conditions |
| Type Safety | Type mismatches, unsafe casts, `any`, missing generics |
| Pattern Compliance | Project conventions — naming, structure, error handling, imports |
| Security | Injection, auth gaps, secret exposure, SSRF, path traversal, XSS |
| Performance | N+1, missing indexes, unbounded loops, memory leaks, large payloads |
| Completeness | Missing tests, missing error handling, incomplete migrations, missing docs, AC ที่ยังไม่ครบ |
| Maintainability | Dead code/assets, magic numbers, inconsistent patterns, deep nesting, unclear naming |

Severity:

| Severity | ความหมาย | Decision ที่ trigger |
|---|---|---|
| CRITICAL | Security vulnerability หรือ data-loss risk — ต้องแก้ก่อน merge | → **BLOCK** |
| HIGH | Bug หรือ logic error ที่น่าจะทำให้เกิดปัญหา — ควรแก้ก่อน merge | → **REQUEST CHANGES** |
| MEDIUM | Code-quality issue หรือ missing best practice — แนะนำให้แก้ | → **APPROVE** (with comments) |
| LOW | Style nit หรือ minor suggestion — optional | → **APPROVE** (with comments) |

**Finding format — ใช้รูปแบบนี้ทุก finding:**

```
- **[Category] `path:line`** — อธิบายปัญหาที่พบอย่างชัดเจนและเจาะจง (ระบุค่า/ชื่อ/บรรทัดจริง)
  **ทำไมถึงสำคัญ:** อธิบายว่าถ้าไม่แก้จะเกิดอะไรขึ้น และกระทบผู้ใช้/ระบบอย่างไร
  **แนะนำ:** วิธีแก้ที่เป็นรูปธรรม เช่น grep หาทั้ง repo / ลบ / ปรับค่า / เปลี่ยนแนวทาง
```

กฎสำคัญ:
- ระบุ `path:line` จาก diff hunks จริงเสมอ ถ้าไม่มี single location ให้ระบุ path เดียว
- อ้างอิงค่าจริงจาก diff เช่นสี hex, class name, import path
- ถ้า finding หลายอัน relate กัน ให้ cross-reference
- ให้ findings ที่มั่นใจสูง ไม่ต้องเยอะ ถ้าไฟล์สะอาดให้บอกตรงๆ
- ตรวจ dead assets/code ที่ถูก replace แต่ไม่ถูกลบ
- ตรวจความสม่ำเสมอ เช่น color values, naming convention, file structure

---

## Step 4 — VALIDATE (SKIPPED)

ไม่มี checkout ใน workspace นี้ — mark ทุก validation row ว่า "Skipped (not checked out)"

---

## Step 5 — DECIDE

| Condition | Decision |
|---|---|
| Zero CRITICAL/HIGH | APPROVE (with comments ถ้ามี MEDIUM/LOW) |
| Any HIGH | REQUEST CHANGES |
| Any CRITICAL | BLOCK |

---

## Step 6 — REPORT

รัน `mkdir -p reviews` แล้วเขียน report ลง `reviews/PR-<pr-number>.md`

เขียน prose เป็นภาษาไทย — code, paths, identifiers, severity keywords (CRITICAL/HIGH/MEDIUM/LOW), decision keyword ให้เป็น English

```markdown
# PR Review: #<pr-number>

**Decision**: APPROVE | REQUEST CHANGES | BLOCK

## Summary
<2–3 ประโยค: PR นี้ทำอะไร (ระบุ file/component จริงที่เปลี่ยน) + ประเมินภาพรวม + headline ว่าพบปัญหาระดับไหน>

## Findings
### CRITICAL
<findings หรือ "None">

### HIGH
<findings หรือ "None">

### MEDIUM
<findings หรือ "None">

### LOW
<findings หรือ "None">

## Validation Results
| Check | Result |
|---|---|
| Type check | Skipped (not checked out) |
| Lint | Skipped (not checked out) |
| Tests | Skipped (not checked out) |
| Build | Skipped (not checked out) |

## Files Reviewed
<แต่ละไฟล์พร้อม change type: Added / Modified / Deleted>
```

---

## Step 6b — JSON OUTPUT

เขียน `reviews/PR-<pr-number>.json` ด้วย schema นี้ (ต้องตรงทุก field):

```json
{
  "prId": "<pr-number>",
  "provider": "github | codecommit",
  "decision": "APPROVE | REQUEST CHANGES | BLOCK",
  "summary": "<2–3 ประโยค ภาษาไทย อาจใช้ Google Chat HTML: <b>, <code>, <br>>",
  "findings": [
    {
      "severity": "CRITICAL | HIGH | MEDIUM | LOW",
      "category": "<Correctness | Security | Maintainability | Completeness | Performance | Type Safety | Pattern Compliance>",
      "description": "<ปัญหา + ทำไมถึงสำคัญ + แนะนำ — ภาษาไทย รวมในฟิลด์เดียว>",
      "location": "<path:line>"
    }
  ],
  "validation": [
    { "name": "Type check", "status": "Skipped (not checked out)" },
    { "name": "Lint", "status": "Skipped (not checked out)" },
    { "name": "Tests", "status": "Skipped (not checked out)" },
    { "name": "Build", "status": "Skipped (not checked out)" }
  ]
}
```

Rules:
- `prId` = pr-number (ตัวเลขเท่านั้น)
- `provider` = "github" หรือ "codecommit" ตาม flag ที่รับมา
- `decision` = keyword เดียวกับ markdown
- `summary` ต้องไม่ว่าง เป็นภาษาไทย
- `findings` — severity UPPERCASE, เรียงตาม severity, `location` optional, ใช้ `[]` ถ้า clean PR
- `validation` ต้องมีครบ 4 items
- Valid JSON — escape quotes/newlines ใน strings, ไม่มี trailing commas

---

## Step 7 — DISCORD NOTIFICATION

หลังเขียนไฟล์ทั้งสองเสร็จแล้ว ให้อ่าน markdown กลับมาแล้วเรียก `send_to_discord` ผ่าน mawin-agent:

```
send_to_discord(
  review_json     = <JSON string ที่เขียนลง reviews/PR-<pr-number>.json>,
  review_markdown = <เนื้อหาของไฟล์ reviews/PR-<pr-number>.md ทั้งหมด>,
  pr_title        = <PR title จาก Step 1>
)
```

Discord จะได้รับ:
- บรรทัดที่ 1: `📋 PR #<id>: <title> — <emoji> <DECISION>`
- บรรทัดที่ 2: `🔴 X crit · 🟠 X high · 🟡 X med · 🟢 X low`
- summary ภาษาไทย
- `📎 Full review → PR-<id>.md` พร้อม file attachment

ถ้า tool ตอบ error ให้บันทึกว่า "Discord: SKIPPED" และดำเนินการต่อ

---

## Step 8 — OUTPUT

**ภาษา:** เขียนทุกอย่างเป็น**ภาษาไทย** ยกเว้น code, paths, identifiers, severity keywords (CRITICAL/HIGH/MEDIUM/LOW), และ decision keyword (APPROVE/REQUEST CHANGES/BLOCK) ให้เป็น English เท่านั้น ห้ามตอบเป็นภาษาอังกฤษไม่ว่ากรณีใด

แสดง **full structured review** ใน chat ตาม format ด้านล่างนี้ทุกครั้ง ห้ามสรุปสั้นหรือตัดส่วนใดออก:

```
# PR Review: #<pr-number>

**Decision**: APPROVE | REQUEST CHANGES | BLOCK

## Summary
<2–3 ประโยค: PR นี้ทำอะไร (ระบุ file/component จริง) + ประเมินภาพรวม + headline ว่าพบปัญหาระดับไหน>

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
<แต่ละไฟล์พร้อม change type>
```

**Finding format** — ใช้ทุก finding:
```
- **[Category] `path:line`** — อธิบายปัญหาเจาะจง (ระบุค่า/ชื่อ/บรรทัดจริงจาก diff)
  **ทำไมถึงสำคัญ:** ถ้าไม่แก้จะเกิดอะไรขึ้น กระทบผู้ใช้/ระบบอย่างไร
  **แนะนำ:** วิธีแก้ที่เป็นรูปธรรม
```
