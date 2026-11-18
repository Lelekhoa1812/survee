# KQA production plan: question types, MCP, and email

Date: 2026-11-13
Status: historical planning record; superseded by the shipped implementation and current documentation.
Scope: make single-choice, checkbox, and free-text unmistakable in the product; expose the host's real controls to other agents over MCP; send the private-link email the product already implies, over the SMTP account already configured.

> **Archive notice (reviewed 2026-11-19):** This document records research and decisions made before implementation. Statements below about missing email, MCP, workspace, analytics, question, or export features describe the repository at that time and are not current product documentation. Several proposed choices and open questions were resolved during implementation. For current behavior, use [`README.md`](../../README.md), [`FORMAT.md`](../FORMAT.md), [`MCP.md`](../MCP.md), [`DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md), and [`INTERVIEW_PACKAGES.md`](../INTERVIEW_PACKAGES.md). Verify implementation in source when the current contract is unclear. The linked plan remains as an audit trail; do not use it as an active backlog or operating guide.

This plan does not choose product policy where the choice changes behaviour. Those forks are in [Decisions required before build](#decisions-required-before-build). Each one has a recommendation.

`graphify-out/graph.json` does not exist in this repo, so this review was done from source, docs, and `node_modules/next/dist/docs/`.

---

## 1. What this update actually is

The request reads as "add three question types, add an MCP server, and turn email on." The code already answers the first of those differently from the brief.

KQA is a host-run interview app. A host uploads one self-contained HTML questionnaire. Each person gets a private link. The HTML runs in a sandboxed frame. Answers autosave to MongoDB. The host reviews and exports them. There is no in-app question builder, no score, and no outbound mail.

The format (`kqa/1`) already stores the three requested shapes, plus five more:

| Requested shape | Existing type | Stored answer |
|---|---|---|
| MCQ, one option | `single` (radios). `select` is the same idea as a dropdown | one option `value` (string) |
| Checkbox, many options | `multi` | array of option values, manifest order |
| Free text | `text` (one line, default 500 chars) and `longtext` (paragraph, default 20,000) | string. Blank after trim clears the answer |

Also already implemented, and used by the starter and the SBC examples: `number`, `scale`, `date`. Validation, the injected runtime, the host answers view, and every export already branch on these types. See `src/lib/format/schema.ts`, `src/lib/format/answers.ts`, `src/lib/format/bridge.ts`.

So the question-type work is not a new answer pipeline. It is a product decision about which types we stand behind, whether any of them are "correct" or scored, and a documentation and review-screen pass so authors and hosts can see the difference. Narrowing the checker to three types would reject files that pass today.

Email and MCP are new. Nothing in the app sends mail. People have a name and an optional private note, not an email address. The host copies a link. Next.js 16 exposes `/_next/mcp` on the **dev server only**, for compiler errors and routes. That is not a product API and must not be reused for interviews.

---

## 2. Current state

### 2.1 Domain and storage

Mongo collections, created on demand with indexes in `src/lib/db.ts`:

| Collection | Type | Role |
|---|---|---|
| `interviews` | `InterviewDoc` in `src/lib/repo/types.ts` | `name`, optional `description`, `mode` `single` or `multi`, `status` `open` or `closed`, `currentVersion` |
| `survey_versions` | `SurveyVersionDoc` | Immutable HTML plus parsed `manifest`. One row per upload. Never edited |
| `participants` | `ParticipantDoc` | `token` (the link secret, unique), `name`, optional `note`, `status` `invited` / `in_progress` / `submitted`, `answers` keyed by question id, `revision` |
| `events` | `EventDoc` | Audit: `open`, `save`, `submit`, `reopen`, `created`, `version`, `status`, `export`. TTL 180 days |
| `login_attempts` | | Failed host logins. TTL 30 minutes |
| `revoked_sessions` | | Signed-out admin session ids |

There is no `email` field on a person, no mail log, no correct-answer field, and no score.

Answer shape (`StoredAnswer` in `src/lib/format/schema.ts`):

```ts
{ value?: string | number | string[]; note?: string; updatedAt: string }
```

`saveAnswers` in `src/lib/repo/index.ts` validates every patch with `validateAnswer` before write. Unknown question ids and illegal values are rejected and never stored. Saves are per question path, so two in-flight saves do not clobber each other. First successful save moves the person from `invited` to `in_progress`. Submit (`submitAnswers`) locks only when every `required` question is answered. "Answered" means a non-empty value (`isAnswered`). A note alone does not count. A checkbox with an empty array is cleared, not stored.

Interview `status` and person `status` are the only status model. The dashboard counts people, invited, in progress, and submitted (`listInterviews`).

### 2.2 How questions are authored and shown

Authoring is the HTML file, not a form builder.

- Create: `src/components/NewInterview.tsx` posts name, description, mode, and HTML to `POST /api/admin/interviews`.
- The checker (`src/lib/survey.ts` → `src/lib/diagnostics/static.ts`) must pass before a version is stored. Replacing a version also runs `compareVersions` (`src/lib/diagnostics/compat.ts`). Changing a question's type when answers exist warns `KQA701` and does not block.
- The candidate never sees a React question component. `src/components/RespondentShell.tsx` loads `/api/p/[token]`, then an iframe at `/api/frame/[token]` with `sandbox="allow-scripts allow-forms"`. The runtime in `src/lib/format/bridge.ts` binds `data-kqa` controls and postMessages changes to the shell, which PUTs `/api/p/[token]/answers`.
- The host reviews in `src/components/AnswersTab.tsx`. Option questions and scales get a tally. Free text, number (except min/max/average), and date do not. `displayValue` shows option labels, joins checkbox labels with `"; "`, and shows text as typed.
- Exports (`src/lib/export/`): JSON, wide CSV, long CSV, XLSX, Markdown. Checkbox raw values are joined with `";"`. Labels are a separate display column.

Limits that already apply (`LIMITS` in `schema.ts`): 3 MB file, 500 questions, 50 options, text 500, longtext 20,000, note 5,000.

### 2.3 People and the link

`addParticipants` stores a name, an optional note, a new 144-bit token, empty answers, status `invited`. Multi-user interviews add people from `PeopleTab` (paste a list of names). One-person interviews create a single participant named "Respondent" at create time and do not allow adding more (`POST .../people` returns 400).

The People empty state says the host can "copy and send however you like" (`src/components/PeopleTab.tsx`). The interview screen says the same (`src/components/InterviewView.tsx`). The home and admin copy say "send every person their own private link" (`src/app/page.tsx`, `src/app/admin/(shell)/page.tsx`). That is the mail the product is describing. It is not sent by the app. There is no results email, because there is no result other than the answers themselves.

Respondent tokens are the credential. Regenerating a token kills the old link (`regenerateToken`). Reopen moves `submitted` back to `in_progress` and unsets `submittedAt`.

### 2.4 Auth and HTTP surface

Host login is one shared account: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET` (`src/lib/env.ts`, `src/lib/auth.ts`). Cookie `kqa_admin`, HMAC, 12 hours, httpOnly. `src/proxy.ts` (Next.js 16's replacement for `middleware.ts`) gates `/admin` and `/api/admin`. Every admin handler calls `guardAdmin` again. Mutations also require `sameOrigin`, so a cross-site page cannot POST.

Public, unauthenticated:

- `GET/PUT/POST /api/p/[token]`, `/answers`, `/submit` — the token is the credential
- `GET /api/frame/[token]` and `GET /api/admin/frame` (admin frame is guarded)
- `GET /api/docs/...` including `/api/docs/bundle.md` — the questionnaire-author bundle

Admin actions that an MCP server must be able to perform, and the function each one already calls:

| Action | Route | Repo / lib |
|---|---|---|
| List interviews | `GET /api/admin/interviews` | `listInterviews` |
| Create interview | `POST /api/admin/interviews` | `prepareSurvey`, `createInterview` |
| Read one interview, people, versions, events | `GET /api/admin/interviews/[id]` | `getInterview`, `listParticipants`, `listVersions`, `recentEvents` |
| Rename, notes, open/close | `PATCH /api/admin/interviews/[id]` | `updateInterview` |
| Delete (must retype the name) | `DELETE /api/admin/interviews/[id]` | `deleteInterview` |
| Check a file, optional compat against an interview | `POST /api/admin/check` | `prepareSurvey`, `withCompat` |
| Replace the questionnaire | `POST /api/admin/interviews/[id]/versions` | `addVersion` |
| Add people | `POST /api/admin/interviews/[id]/people` | `addParticipants` |
| Edit name/note, remove | `PATCH` / `DELETE /api/admin/people/[pid]` | `updateParticipant`, `deleteParticipant` |
| Reopen, new link | `POST /api/admin/people/[pid]/reopen` or `.../token` | `reopenParticipant`, `regenerateToken` |
| Export | `GET /api/admin/interviews/[id]/export?format=` | `exportInterview` |
| Sign in / out | `/api/admin/login`, `/logout` | session cookie. Not an agent tool |

There is no route that sends mail, and no package for SMTP or IMAP in `package.json`.

### 2.5 Environment and deploy

`src/lib/env.ts` reads `MONGODB_URI`, `MONGODB_DB` (default `kqa`), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET`. Dev fallbacks exist only when `NODE_ENV` is not production and `VERCEL` is unset.

`.env.example` documents those five. The local `.env` also defines, by name only: `SMTP_HOST`, `SMTP_PORT`, `IMAP_HOST`, `IMAP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, plus `MONGODB_USERNAME` and `MONGODB_PASSWORD`. The app never reads the mail variables. `.env.example` does not list them. Whether the Vercel project has the mail variables set was not checked. `.vercel/project.json` shows the linked project name `kqa`.

`next.config.ts` traces `./docs/**` into the serverless bundle for the docs routes, denies framing except the questionnaire frame routes, and marks `mongodb`, `exceljs`, and `parse5` as server-external. There is no `vercel.json` and no `maxDuration`.

Deploy path in the README: Vercel, five env vars, Atlas network access, `vercel --prod`.

### 2.6 Docs that mention question types

Already accurate for eight types, and generated where noted:

- `docs/FORMAT.md` sections 3.3, 3.4, 4, and 6. This is the spec.
- `docs/AGENT_PLAYBOOK.md`. The mapping table includes checkbox and free text. The copy-paste card in step 3 shows only a radio group, which is the closest the docs come to looking MCQ-only.
- `docs/DIAGNOSTICS.md` and `src/lib/diagnostics/catalog.ts` (`KQA208`, `KQA302`, `KQA303`, `KQA313`). `DIAGNOSTICS.md` is generated by `npm run docs`. Do not edit it by hand.
- `docs/kqa-manifest.schema.json`, also generated from the zod schema.
- `docs/template/starter.kqa.html` already contains radios, checkboxes, a dropdown, text, longtext, number, scale, and date.
- `docs/examples/sbc-investor-client.kqa.html` and `sbc-investor-internal.kqa.html` are real questionnaires, not MCQ-only fixtures.
- `README.md` points at the starter as "every question type". It does not mention mail, SMTP, or a product MCP server.
- `AGENTS.md` is only the Next.js 16 agent-rules block. It does not describe KQA.
- In-app Format guide (`src/app/admin/(shell)/docs/[[...slug]]/page.tsx`) and `Copy everything for an AI agent` serve `src/lib/docs.ts`, which bundles FORMAT, the playbook, diagnostics, the schema, and the starter. That bundle is for **writing a questionnaire**, not for operating the host.

Product copy that tells a person to send a link, and that a future email change must keep honest:

- `README.md` opening
- `package.json` `description`
- `src/app/admin/(shell)/page.tsx`
- `src/app/page.tsx`
- `src/components/PeopleTab.tsx` empty state and add-people hint
- `src/components/InterviewView.tsx` link callout
- `src/components/NewInterview.tsx` mode descriptions
- `src/components/RespondentShell.tsx` invalid-link line ("Ask your host to send the link again")
- `src/lib/format/schema.ts` file comment
- `src/lib/repo/types.ts` participant comment

No file says the product is multiple-choice only.

### 2.7 Next.js 16 constraints that the build must respect

Read from `node_modules/next/dist/docs/` for this install (`next` `^16.4.6`):

- Request interception is `src/proxy.ts`, not `middleware.ts`. The matcher is only `/admin/:path*` and `/api/admin/:path*`. A new `/api/mcp` route is outside that matcher, so the route handler is the only lock. That is the right shape, as long as the handler rejects missing credentials before it touches Mongo.
- Product tools belong in an App Router route handler (`route.ts`), Node.js runtime (`export const runtime = "nodejs"`), because MongoDB and SMTP need Node. Do not put them on the Edge runtime.
- Set `export const maxDuration` on any route that opens SMTP or IMAP. Vercel will kill the invocation at the plan default (often 10 seconds on Hobby, 60 on Pro unless raised). One SMTP send fits. A loop over every person, or an IMAP connection left open, does not.
- `/_next/mcp` (`node_modules/next/dist/docs/01-app/02-guides/mcp.md`) is the development server's diagnostic endpoint (`get_errors`, `get_routes`, and similar), reached through `next-devtools-mcp` while `next dev` is running. It is absent in production. It cannot create interviews or send mail.
- Docs read from disk at request time must be listed in `outputFileTracingIncludes`, the same way `/api/docs/[...name]` already is.

---

## 3. Proposed domain model

Keep `kqa/1` and the current answer document. Do not add a second question store beside the manifest.

### 3.1 The three shapes, on the types that already exist

**Single choice (`single`, and `select` if we keep it).**
The candidate picks one option. The stored value is that option's `value`, never the label. Empty string clears it. A required question is answered only when one allowed value is stored. Radios cannot be unticked by the browser; the page should keep offering a clear control that calls `KQA.clear`, which the runtime already supports.

**Checkbox (`multi`).**
The candidate ticks any subset. The stored value is a string array, duplicates removed, sorted into manifest order so exports stay stable (`validateAnswer`). An empty selection clears the answer. Required means at least one tick, which is what `isAnswered` does today. There is no `minSelected` / `maxSelected`. Adding one is a product decision, not a bugfix.

**Free text (`text` and `longtext`).**
The candidate types. The stored value is the string, with leading and trailing emptiness treated as "no answer". Over-length is rejected, not truncated. Nothing checks that a `text` field is an email address, a URL, or a phone number; `type="email"` on the input only changes the phone keyboard (FORMAT.md already says this). The optional `note` on any question is a second free-text field beside the answer. It is not a free-text question, and it must stay that way so authors do not fake a paragraph question with a note.

`number`, `scale`, and `date` stay valid unless a decision below removes them. Existing saved answers for those types are numbers or `YYYY-MM-DD` strings and must keep validating.

### 3.2 Scoring and correctness

**There is no correctness model today.** A question has no answer key. Progress is "did they put something in." Submit does not grade. Exports do not mark right or wrong. The SBC internal example even tells the reader the platform does not score.

That is the policy fork. Do not invent a pass mark in the build.

If the decision is to keep KQA as an interview (recommended):

- Single choice is correct only in the human sense: the host reads the chosen label.
- Checkbox is correct only as the set the person chose. Comparing it to a secret set is out of scope.
- Free text has no key. "Answered" is "non-empty after trim." The host reads the paragraph. The answers view must not show a tally or a percentage for it.
- Do not add `correct`, `score`, `rubric`, or `keywords` to the manifest in this release.

If the decision is a private key for the host only, the smallest model that does not lie about free text:

- Optional `key` on `single` and `select`: one option value. Optional `key` on `multi`: an array of option values. Absent key means "not a marked question."
- Match for `single`: stored value equals the key.
- Match for `multi` must be chosen explicitly: exact set, or partial credit. Those two numbers tell different stories. Do not ship both under one word ("score").
- Free text: status `review`, never auto-matched. No keyword list in this release. A keyword list will mark fluent wrong answers as right and right answers as wrong.
- The candidate never sees the key, the match, or a total. The frame stays a questionnaire. The host answers view may show a quiet "matches the key" mark.
- Keys live in the immutable survey version, like the rest of the manifest. Changing a key is a new version. Old exports stay reproducible.
- Compatibility: removing or changing a key is a warning, same family as `KQA701`, not a migration of old answers.

A candidate-facing quiz (show the score, lock until they pass) is a different product. It fights the current submit copy ("your answers are locked, your host can reopen them") and should not be folded into this release.

### 3.3 People, for email

Add an optional `email` on `ParticipantDoc` and on the JSON handed to the People screen. Do not require it to create a person. Require it only to send. Keep `note` as the host's private reminder. Do not overload `note` to hold the address.

One address per person. Same address on two people in one interview is a warning the host can override, not a unique index (a person can be invited twice on purpose only if the host insists; the default UI should say so). The same address on two interviews is normal.

One-person mode keeps a single participant. The host can set that person's name and email so the one link can be mailed. Do not silently turn one-person mode into multi-user.

### 3.4 Mail record

New collection `mail_messages`, written only by the app:

- `interviewId`, `participantId`
- `kind`: `invite` in this release
- `to` (the address at send time, so a later edit does not rewrite history)
- `status`: `sent` or `failed`
- `error` (short, no secrets, no SMTP conversation dump)
- `messageId` from the SMTP server when accepted
- `sentAt`, `triggeredBy`: `admin` or `mcp`

Do not store the message body (it contains the tokenised link). Do not store `SMTP_PASSWORD`. A person may have many rows (failed, then sent, then a deliberate resend).

"Invited" as a person status stays "has a link and has not saved." It must not start meaning "we emailed them." The People screen needs a separate mail state: not sent, sent at time, failed.

### 3.5 What happens to interviews already in Mongo

No answer rewrite. Documents that already have `single` answers stay valid. `multi` arrays and text strings already match the validator. New fields (`email`, mail rows, and a key only if that decision is yes) are optional. Old documents without them keep working. Do not bump `format` to `kqa/2` for an optional field. A format bump would force every example, the starter, and every stored manifest through the checker again for no storage change.

If a later decision removes `scale`, `number`, `date`, or `select`, that **is** a migration: the checker would reject the starter and any live survey that uses them, and `KQA701` would fire on replacement. That path needs an inventory of live manifests first. This plan could not read production Mongo.

---

## 4. MCP server

### 4.1 Shape

A real MCP server other agents connect to, in this Next.js app, calling the functions in `src/lib/repo/index.ts` and the checker. One implementation. The admin UI and the MCP tools go through those functions so a rule changed for the screen cannot drift from the agent.

Transport: **stateless Streamable HTTP** on `POST /api/mcp` (and `GET`/`DELETE` only as the MCP spec requires for session lifecycle). Each tool call is one serverless invocation. The handler speaks the MCP JSON-RPC protocol and then returns. It does not hold a stdio process, and it does not keep an SSE stream open waiting for the next call. Vercel will freeze or kill a long-lived stream, and a stdio server cannot be reached by a remote agent at all.

A five-line local config is how Cursor, Claude Desktop, and other agents connect: an MCP client entry whose URL is `https://<deployment>/api/mcp` and whose header is `Authorization: Bearer <token>`. A tiny stdio-to-HTTP shim is optional for clients that still only spawn a process. The shim must not reimplement tools.

Runtime: Node, `maxDuration` long enough for one SMTP send plus a Mongo round trip (30 seconds is enough and stays inside typical Pro limits). `serverExternalPackages` only if a mail library breaks the bundler. Reuse `col` from `src/lib/db.ts` so the Mongo client stays cached on the warm instance the way pages already do.

Do not mount tools on `/_next/mcp`. Do not put host mutations on `/api/docs`, which is public and cacheable.

### 4.2 Auth

Random agents must not mutate production.

- New secret `KQA_MCP_TOKEN`, at least 32 bytes, set in `.env` locally and in the Vercel project for production. Compared with `timingSafeEqual` against the `Authorization: Bearer` header. Missing, wrong, or short token: 401 and no database call.
- The token is not `ADMIN_PASSWORD`, not `SESSION_SECRET`, and not a respondent token. Those three already have jobs, and putting the admin password in an agent config spreads it.
- The admin cookie and `sameOrigin` do not apply. Agents have no browser origin. `guardAdmin` would reject every legitimate call. Write `guardMcp` instead.
- Refuse the token in a query string. URLs end up in logs.
- Every tool call writes an `events` row (`type` extended with `mcp`) with tool name, interview id when present, and success or failure. Do not write argument values that contain HTML, answer text, or links.
- Rate-limit failed auth the way `login_attempts` already limits the password form, so a scanner cannot grind the token.
- Respondent links returned by tools are secrets. They are visible to anyone holding `KQA_MCP_TOKEN`, which is the same trust as the host login. Do not also return them from any unauthenticated route.
- The public format bundle stays public and stays out of this server. An agent that writes HTML keeps using `/api/docs/bundle.md`. An agent that runs an interview uses MCP.

Recommended credential: one token that can read and write. Splitting read and write is extra operational surface for a single-host app. If that split is wanted, it is decision 7 below.

Tools that delete, replace a link, or send mail are not idempotent in a dangerous way: delete still requires the interview name, a new link returns the new token once, send defaults to "already sent" unless `resend` is true.

### 4.3 Tool inventory

Names are the MCP tool names. Inputs are the arguments. Outputs are the structured tool result. "Maps to" is the existing behaviour. New behaviour is marked.

Read tools:

| Tool | Purpose | Inputs | Outputs | Maps to |
|---|---|---|---|---|
| `list_interviews` | Host's interview list | none | `{ interviews: InterviewSummary[] }` including people counts and open/closed | `listInterviews` |
| `get_interview` | One interview and its current manifest summary | `interviewId` | interview fields, `currentVersion`, question list `{ id, type, label, required, section }`, counts. HTML omitted (it can be 3 MB) | `getInterview` + current `getVersion` |
| `get_survey_html` | The stored file, when an agent must edit it | `interviewId`, optional `version` (default current) | `{ version, fileName, html, manifest }` | `getVersion` |
| `list_versions` | Upload history without HTML | `interviewId` | version, file name, bytes, check counts, question count, createdAt | `listVersions` |
| `check_questionnaire` | Checker, nothing stored | `html`, optional `fileName`, optional `interviewId` for the compat diff | `{ ok, report, markdown }` | `POST /api/admin/check` |
| `list_people` | People on an interview | `interviewId` | id, name, email, note, status, progress, lastSavedAt, submittedAt, mail status, and the private link | `listParticipants` plus progress |
| `get_person` | One person | `personId` | the same fields as one row of `list_people` | `listParticipants` filtered, or a small new getter |
| `get_answers` | Answers for review | `interviewId`, optional `personId`, optional `submittedOnly` | for each person: status and `{ questionId, type, label, value, display, note, updatedAt }`. `display` uses `displayValue` | `listParticipants` + current manifest |
| `get_status` | The numbers a host looks at first | `interviewId` | interview open/closed, version, counts by person status, required-still-missing per person, last activity | `listInterviews` detail + `progress` |
| `list_events` | Recent audit | `interviewId`, optional `limit` (max 50) | the same rows as `recentEvents` | `recentEvents` |
| `export_interview` | A file the host can already download | `interviewId`, `format`: `json`, `csv-wide`, `csv-long`, `md`, `xlsx` | text formats as a string; `xlsx` as base64 plus filename and content type | `exportInterview` |
| `get_mail_status` | Did the invite go out | `personId` or `interviewId` | mail rows: kind, to, status, sentAt, error. No body, no link | new `mail_messages` read |

Write tools:

| Tool | Purpose | Inputs | Outputs | Maps to |
|---|---|---|---|---|
| `create_interview` | Create from a questionnaire file | `name`, optional `description`, `mode` `single` or `multi`, `html`, optional `fileName` | `{ id, report }` or the checker failure, nothing stored | `prepareSurvey`, `createInterview` |
| `update_interview` | Rename, notes, open or close | `interviewId`, optional `name`, `description`, `status` | `{ ok: true }` | `updateInterview` |
| `delete_interview` | Delete interview, versions, people, answers | `interviewId`, `confirmName` exactly equal to the name | `{ ok: true }` | `deleteInterview` |
| `upload_survey_version` | Replace the live file | `interviewId`, `html`, optional `fileName` | `{ version, report }` or checker errors | `withCompat`, `addVersion` |
| `add_people` | Add people and their emails | `interviewId`, `people: { name, email?, note? }[]` (max 100, same as the route) | created people including links. Fails on one-person interviews, same as today | `addParticipants` plus email |
| `update_person` | Change name, email, note | `personId`, optional fields. Empty email clears it | updated person | `updateParticipant` |
| `remove_person` | Remove the person and their answers | `personId` | `{ ok: true }` | `deleteParticipant` |
| `reopen_person` | Unlock a submitted person | `personId` | updated person, or a clear error if they have not submitted | `reopenParticipant` |
| `regenerate_link` | Kill the old link and issue a new one | `personId` | `{ token, link }` | `regenerateToken` |
| `send_invite` | Send the private-link email | `personId`, optional `resend` (default false). Or `interviewId` plus `personIds` (max 20) | per person: `sent`, `already_sent`, or `failed` with a short reason | new mail function. SMTP only |

Not tools, on purpose:

- Login and logout. The bearer token is the session.
- Saving or submitting as the candidate. The host cannot do that in the app today. An agent should not answer for someone.
- A general IMAP "read my inbox" tool. That would hand an agent every message in the Gmail account.
- The Next.js devtools tools.

`send_invite` is the email action the user triggers through MCP. The People screen should call the same function so the two cannot diverge. Whether the screen gets a button in the same release is decision 6.

### 4.4 Errors the tools return

Same sentences the UI already uses, as tool error text, not stack traces: interview not found, file failed the checker (include `markdown`), one-person mode cannot add people, confirm name did not match, person has no email, interview is closed, Gmail refused the message. Checker failures return the report and do not create a version.

---

## 5. Email

### 5.1 What the product is supposed to send

Today it sends nothing. The action the screens describe is: give each person their private link. That is an **invite**. It contains the person's name, the questionnaire title, one link (`https://<host>/<token>`), and two facts the respondent UI already promises: answers save as they go, and submit locks them until the host reopens.

It does not contain other people's names, any answers, a score, or an export. There is no results mail to design until a scoring decision says there is a result.

A "we received your submission" note to the person, or a "someone submitted" note to the host, are extra products. They are decision 5. They are not what the current copy describes.

### 5.2 SMTP and IMAP

| | SMTP | IMAP |
|---|---|---|
| Job | Send the invite | Optional later: look for a bounce for a message we already sent |
| Server | `SMTP_HOST` / `SMTP_PORT` (already `smtp.gmail.com` / `587` in `.env`) | `IMAP_HOST` / `IMAP_PORT` (already `imap.gmail.com` / `993`) |
| Identity | `SMTP_USER` plus `SMTP_PASSWORD` already in `.env` | Same user and the same app password. Gmail allows this. Do not add a second password |
| From | The `SMTP_USER` mailbox. Gmail will reject or rewrite anything else | Not used to send |
| When | Only when a host or an MCP client calls send | Only when a client calls `get_mail_status` and a sent row has no bounce check yet, if that decision is in scope |

Connect, send or search, disconnect. No IDLE, no background poller. Vercel has no always-on process in this app, and Gmail will drop idle clients anyway.

IMAP, if built, searches only for delivery-status notices that reference a `messageId` we stored. It returns `delivered`, `bounced`, or `unknown`. It does not return subject lines or bodies of unrelated mail. It uses `BODY.PEEK` so it does not mark the mailbox read. Connection budget: 8 seconds, then `unknown` and a failed-check timestamp. This is decision 4. The invite can ship with SMTP alone; the People screen already has sent/failed from the SMTP response.

### 5.3 Env vars (names only)

Read these in `src/lib/env.ts` the same way as Mongo: fail with a clear error when a send is attempted, not at process start, so a missing mail password does not take down the rest of the app.

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD` (already in `.env`; never log, never return, never copy into docs)
- `IMAP_HOST`
- `IMAP_PORT`
- `KQA_MCP_TOKEN` (new)
- Existing: `MONGODB_URI`, `MONGODB_DB`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET`

Add the names and a one-line purpose to `.env.example`. No real values. Production values are set in the Vercel project. A local `.env` is not the production environment.

Display name on the message: a fixed product name ("KQA"), address `SMTP_USER`. Reply-To equals From unless a later decision adds a host reply address. Do not invent a reply inbox.

### 5.4 Template

Plain text and a short HTML alternative, same words.

- Subject: `{questionnaire title}`
- Greeting: the person's name
- One sentence: you have a private questionnaire from the host
- The link, once, as a real URL
- One sentence: it saves as you go, you can leave and come back, submit locks it
- One sentence: if you were not expecting this, ignore it
- No images, no remote fonts, no tracking pixel. The questionnaire sandbox story is "we do not watch you with beacons"; the mail should match.

The link uses the request origin the admin UI already uses (`origin` on the People screen), or `KQA_PUBLIC_URL` if we need sends from MCP when there is no browser. MCP sends should take the public URL from a new env var `KQA_PUBLIC_URL` so a preview deployment cannot stamp the wrong host into a mail by accident. If it is unset, `send_invite` refuses rather than guessing.

### 5.5 Failure handling

- No email on the person: do not call SMTP. Tool and button say "Add an email address first."
- Interview closed: do not send. The link would open onto a locked page. Say that.
- Interview missing, or person missing: same 404 language as the routes.
- Address fails a basic shape check (one `@`, no spaces): do not call SMTP.
- Already sent and `resend` is false: return the existing row. Do not send a second mail.
- SMTP timeout, auth failure, or a 4xx/5xx from Gmail: write `failed` with a short reason, leave the person in place, allow retry. Auth failure should not be retried in a loop inside one request.
- A batch stops at 20 people per call. Each person is their own SMTP message (never Bcc). One rejection does not cancel the ones already accepted. The tool returns one result per person.
- Gmail consumer mailboxes are capped at about 500 recipients a day and will temporarily block a new app password that sends in bursts. The batch cap is how we stay under a single function timeout. The daily cap is a product limit: the tool should surface Gmail's rate-limit text, not hide it as "something went wrong."
- Logs: recipient domain is enough in an error string. Never the password, never the full link, never the message source.

### 5.6 How an MCP client triggers send

1. `add_people` with `name` and `email`, or `update_person` to set `email`.
2. `send_invite` with `personId`, or with `interviewId` and a list of ids.
3. `get_mail_status` to read `sent` or `failed`.

The client does not pass the SMTP password, the From address, or the link. The server builds the link from the stored token and `KQA_PUBLIC_URL`.

---

## 6. UI and UX

The candidate's questions stay inside the HTML file and the design kit in `docs/template/starter.kqa.html`. This release does not add a second authoring UI. An in-app builder would be a new product beside the checker, and the two would drift. Authors (people and agents) keep writing the file. The app's job is the chrome around it, the People screen, and the review screen.

### 6.1 Authoring the file

One question, one card (`.kq-q`). The label is the question. `help` is the instruction, in the manifest, so the host's review still makes sense when the page is gone.

**Single choice.** A fieldset whose legend is the question (visually hidden if the heading already says it). One radio per option, 44 px row, the whole row is the label. Selected row uses the existing accent, not a second colour language. `help` is "Pick one." Nothing is pre-checked (`KQA320`). If the question is optional, a text button under the group calls `KQA.clear` and is labelled "Clear selection." Keyboard: native radios, visible focus ring from the kit. On a phone the rows stack full width. There is no "other" unless the manifest has an `other` option plus a note field; do not add a text box that is not in the manifest, because it will not save.

**Checkbox.** Same card and the same row metrics. `help` is "Tick all that apply." Each row toggles on its own. Under the group, a quiet line: "None selected" or "2 selected", from the ticks on the page, updated when `KQA` fires `change`. Storage order is the manifest order, not the order they were ticked; the page does not need to show that. Required and still empty: the app's submit dialog already lists the question label. The card itself should not invent a red error until submit, matching the rest of the kit.

**Free text.** `text` is one line, for a name, a company, a short figure. `longtext` is a textarea, four rows, growing with the content up to the card width, for a real answer. Placeholder text is an example ("For example, a team of four"), never a value, and it is not in the manifest as a default. Show the character count only after the person has used 80% of `maxLength`, in `ink-2`, and in the danger colour at the limit. The server still rejects over-length; the count is so they see it before the toast. Pasting a paragraph into `text` is allowed up to the limit. Do not auto-convert it to `longtext`. Empty, after trim, clears the answer and the status tick returns to empty.

Loading inside the file: the runtime sets `data-kqa-state="loading"` until `init` arrives. Cards should not flash as empty-and-editable and then pop filled. The kit can keep controls visible and let the app bar carry "Loading the questions…", which `RespondentShell` already does until the frame says hello.

### 6.2 What the candidate sees around the file

This chrome already exists. Keep it. Do not add a score, a correct-answer reveal, or a per-question wizard.

- Opening: "Opening your questionnaire…" then "Loading the questions…" on the frame.
- Ready: title, "Answering as {name}", "N of M answered", save state.
- Save states, already in the bar: "Autosave on", "Saving…", "Saved", "Retrying…", "Offline, will save". A rejected value toasts the server's reason and the frame is reset to what was stored (`RespondentShell` flush path). That reset is how a checkbox sent as a string, or a novel option, comes back unticked. The toast must name the reason, which it already does.
- Submit asks, lists missing required labels, or confirms the lock. After submit, the banner is "Submitted. Your answers are locked, and your host can reopen them if you need a change." Controls in the frame disable via `lock`.
- Closed interview, not submitted: the warn banner, controls locked.
- Bad link: "This link is not valid" and ask the host to send it again. Once mail exists, that sentence stays true.
- Network error on first load: "We could not open this just now" and Try again. Copy says answers are safe. That is true only after at least one save; the first-load failure has nothing stored yet, and the sentence should be changed to "Nothing you have already saved is lost" so a brand-new visitor is not misled.

The bar's "N of M" counts a checkbox once, whether they ticked one option or all of them, and counts a free-text question once when the trimmed value is non-empty. That matches `progress` and must stay the submit rule.

### 6.3 What the author (the host) sees

**Creating.** Unchanged flow: name, one person or multi-user, drop the HTML file, wait for the checker, create. The checker report remains the error state. An empty file drop is the uploader's empty state. Do not add question-type pickers on this screen.

**People.** The add dialog gains an email field beside name and note. Paste still accepts one name per line, and also `Name, email` or `Name <email>` so a host can paste from a spreadsheet without a second tool. Rows with a name and a bad email are not saved; the field explains "That does not look like an email" on that row. Rows with a name and no email are saved, and the row shows "No email" where the send control will be.

The table columns become: name, email, status (Not started / In progress / Submitted), progress, last saved, link, mail.

Mail cell:

- No address: the send control is disabled. Hint: "Add an email to send the link."
- Ready: button "Send link".
- Sending: the button shows the existing spinner and "Sending…". Disable a second click.
- Sent: "Sent" plus the relative time, and a quiet "Send again" that confirms ("They already received a link. Send another?").
- Failed: the short reason, and "Try again".

Copy link and Open stay. Sending mail does not replace the copy button. A host will still hand a link over in a meeting.

Empty people state: "Add each person who will answer. KQA creates a private link, and you can email it from here or copy it." One-person mode: a single row, with email and send, no "add many."

**Review.** By question and by person stay.

- Single choice: the tally of labels, then each person's chosen label. Show the label, with the raw value only in the existing code-sized meta if a host needs it. Do not show a score.
- Checkbox: the tally counts a person toward every option they ticked, which `Tally` already does, and the person's line is the labels joined in manifest order ("Email; Phone"), not a JSON array. A person who ticked nothing is in the "not answered" count.
- Free text: no bars. The answer is the paragraph, wrapped, preserving line breaks, in the same `.val` block. Long answers collapse after about eight lines with "Show the rest" on that person only. Empty is "No answers yet" on that question, the same sentence the tab uses now.
- A note under any type stays the quieter `.note` line. It must not be styled as if it were the answer.

No answers yet: keep the current empty card ("Answers appear here the moment someone saves them"). A person who was emailed and has not opened the link is still "Not started" on People, and absent from answer rows. That distinction should stay visible so a host does not read "No answers yet" as "the email failed."

**Loading and errors on the host.** The interview page already refreshes after a mutation. Send uses the same toast pattern as reopen ("Link sent to Ada" / the server's sentence). A 401 bounces to login through the existing proxy. A Gmail failure is a toast and a failed mail cell, not a full-page error.

---

## 7. Documentation to update

Update these so a reader cannot walk away thinking the app is MCQ-only, that links are only copied by hand, or that `/_next/mcp` operates production.

Write by hand:

- `README.md` — the three primary shapes, pointing at the eight-type spec if we keep all eight; how a host sends a link; that agents operate the host through MCP; env table extended with mail and `KQA_MCP_TOKEN` names only; security section gains the bearer token and "the link in the email is the respondent's credential."
- `docs/FORMAT.md` — a short lead that names `single`, `multi`, and `text`/`longtext` as the everyday types and points at 3.4 for the rest. State in section 6 that the app does not grade answers, unless the scoring decision adds a key, in which case document the field here and only here as the spec. State that the HTML file never sends email.
- `docs/AGENT_PLAYBOOK.md` — step 3 needs three card patterns (radio, checkbox, text/textarea), not only the radio snippet. The mapping table stays. Add one paragraph: operating a live interview is the MCP server, not this playbook. This playbook remains "write the file."
- `docs/template/starter.kqa.html` — only if a pattern is missing or the clear-selection / selected-count / character-count behaviours are adopted. It already demonstrates every type. Recheck with `npm run check`.
- `AGENTS.md` — under the Next.js block, a short KQA section: product tools are the MCP server described in `docs/MCP.md`; `/_next/mcp` is the framework dev server; questionnaire authors follow `docs/AGENT_PLAYBOOK.md`. Do not remove the Next.js block; `next dev` rewrites it.
- New `docs/MCP.md` — URL, auth header, the tool list, and what is deliberately absent. This page is for agent operators. Do not add it to `buildBundle()` in `src/lib/docs.ts`. The copy-for-an-agent bundle would otherwise mix "write HTML" with "here is how to delete production interviews."
- `.env.example` — names and purposes. No secrets.
- `package.json` `description` — one clause that a host can email the private link. Keep it one sentence.
- In-app strings listed in section 2.6, so the screens and the README agree.
- Comments on `ParticipantDoc` and `schema.ts` once email or a key exists.

Generated, only if the catalog or the zod schema changes:

- `docs/DIAGNOSTICS.md`
- `docs/kqa-manifest.schema.json`
- Run `npm run docs` and commit the result with the schema change. A test already fails if they drift.

Review, and edit only if a schema change makes them fail the checker:

- `docs/examples/sbc-investor-client.kqa.html`
- `docs/examples/sbc-investor-internal.kqa.html`

Code comments that describe behaviour, updated in the same change as the behaviour:

- `src/lib/env.ts`
- `src/lib/repo/types.ts`
- `src/lib/diagnostics/catalog.ts` (only if a new code is added for a key or for email, which the questionnaire checker does not need)
- `src/proxy.ts` comment, so the next reader sees that `/api/mcp` is intentionally outside the cookie matcher and authenticates itself

Tests that lock the current type list and will need a deliberate update if the type list changes: `tests/checker.test.ts`, `tests/checker-regressions.test.ts`, `tests/export.test.ts`.

---

## 8. Phased build

Each phase ships on its own and has a review before the next starts. Do not start a phase whose decision is still open.

### Phase 1 — Question types, docs, and review

Depends on decisions 1, 2, and 3.

- If we keep all eight types: no validator change. Extend the playbook examples, the FORMAT lead, the README, and the answers view (checkbox labels, wrapped free text, show-the-rest). Fix the first-load error sentence.
- If we add a host-only key: optional manifest fields, host mark, compat warning, generated schema and diagnostics, tests for match and for "no key means no mark." Candidate frame unchanged.
- If we narrow types: that is a breaking checker change. Inventory stored manifests first. Update starter, examples, catalog, and tests in the same change.

Quality review before phase 2:

- `npm test`, `npm run typecheck`, `npm run check -- docs/template/starter.kqa.html`.
- Both SBC examples still check, or the review records which decision broke them.
- A fixture interview with one `single`, one `multi`, and one `text` shows the right label, the joined ticks, and the paragraph on the answers tab, at desktop width and at 390 px.
- Submit still blocks only on empty required questions, including an empty checkbox and a whitespace-only text field.
- An old manifest with no new fields still uploads.

### Phase 2 — Email address and SMTP invite

Depends on decisions 4, 5, and 6. Can be reviewed with the admin UI before MCP exists.

- `email` on the participant, People UI, `mail_messages`, a single `sendInvite` function, nodemailer (or the Node SMTP client) using the env names above.
- Button on the person row, and send-again confirmation.
- `.env.example` names. Wire `SMTP_*` through `env.ts`.
- Do not send a real message in CI. Tests use a fake transport and assert the subject, the single link, and that the password never appears in the body or the thrown error.

Quality review before phase 3:

- Add a person with no email, with a bad email, and with a good email. Only the last can send.
- Closed interview refuses.
- Second send without `resend` does not open a second SMTP connection.
- A forced SMTP failure leaves `failed` on the row and the person still `invited`.
- One real send to an address the owner controls, done by the owner, not by the test suite. Confirm the link opens the right person and that Gmail did not rewrite the From address.
- Confirm the six mail names exist in the Vercel project before `vercel --prod`. This plan could not see that.

### Phase 3 — MCP

Depends on decision 7. The tools call phase 1 and phase 2 functions, not a parallel data path.

- `POST /api/mcp`, bearer auth, the tool list in section 4.3, `docs/MCP.md`, the `AGENTS.md` pointer, README.
- `send_invite` is in this phase even if the button shipped in phase 2, so the agent is not blocked on a later project.
- A scripted MCP client against `next dev` with a local token: list, create from the starter, add a person with an email, read status, read answers, and send against the fake transport.

Quality review before phase 4:

- No token, wrong token, and token in the query string are all 401, and Mongo is not queried (assert with a log or by using a bad `MONGODB_URI` only on that test process — do not point a test at production).
- `delete_interview` without the exact name fails and leaves the data.
- `check_questionnaire` with an error does not create an interview.
- Cookie-less call succeeds with the bearer. A call with only the admin cookie and no bearer fails. The two doors stay separate.
- Tool list in `docs/MCP.md` matches the registered tools. Drift here is the failure mode.

### Phase 4 — IMAP bounce check, only if decision 4 says to include it

- `get_mail_status` gains `delivery: delivered | bounced | unknown` from a bounded IMAP search for our `messageId`.
- Test with a saved bounce fixture. No live IMAP in CI.
- Quality review: a mailbox search that does not match returns `unknown` and no message bodies. A timeout returns `unknown`. Unrelated mail is not in the tool result.

Stop after phase 3 if IMAP is deferred. The release is still complete: agents can send, and the host can see SMTP success or failure.

---

## 9. Risks

**Vercel and MCP.** A long-lived SSE or stdio server will not survive this deploy. Stateless Streamable HTTP fits. Cold starts add a Mongo handshake; `src/lib/db.ts` already caches the client on the instance. Tool handlers must stay under `maxDuration`. Exporting a huge XLSX and sending mail in the same call would blow it; they are separate tools. The proxy matcher must stay narrow so `/api/mcp` is not 302'd to the login page before the bearer check runs.

**Gmail limits.** The account behind `SMTP_USER` is a consumer Gmail mailbox (the host in `.env` is `smtp.gmail.com`). Expect a few hundred recipients per rolling day, throttling if many go out at once, and refusal if the app password is revoked. Sending one message per person makes a failure local, and it spends the quota faster than a single digest would. A digest is the wrong shape because each link is a different secret. If volume grows past that mailbox, the fix is a transactional provider, not IMAP.

**Secrets.** `SMTP_PASSWORD` and `KQA_MCP_TOKEN` live in the environment, never in the repo, the plan, tool output, or event `meta`. `.env` is local. Production is the Vercel env. Rotating the Gmail app password is a Vercel change plus a local `.env` change, and it does not require a migration. The MCP token is a production key: anyone with it can delete interviews. Treat it like `SESSION_SECRET`.

**Respondent links in email.** The message is the credential. Forwarding it forwards access. Regenerating the link must be understood to invalidate the mailed URL. The mail log must not keep the body.

**Mongo and existing interviews.** Additive optional fields do not require a migration. A type-narrowing release does. `KQA701` already warns when a replaced file changes a question's type under live answers; keep that warning if keys or types change. `survey_versions` stay immutable so an export of last week's file still matches last week's answers.

**Same-origin vs agents.** Reusing `guardAdmin({ mutating: true })` for MCP would 403 every agent. Bypassing auth entirely because "it is our agent" would leave `/api/mcp` open on the public deployment. The bearer check is the whole lock.

**Next.js dev MCP confusion.** An agent pointed at `/_next/mcp` on a laptop will see compile errors and will not see production interviews. Docs have to say this in the first paragraph of `docs/MCP.md`.

**Checker and docs drift.** `npm run docs` regenerates diagnostics and the JSON Schema. Editing those two files by hand will fail the drift test, or worse, pass if someone forgets to run it and the in-app guide lies. Schema changes go through `schema.ts` and `catalog.ts` only.

---

## 10. Decisions required before build

These are the forks that change the design. Recommendations are included so a choice is easy to accept or override. They are not implemented by this plan.

### 1. The format already has eight question types. What should this release do?

- **A. Keep all eight. Treat single-choice, checkbox, and free text as the ones we document first, and leave number, scale, date, and dropdown working.** Recommended. The starter, the SBC examples, the checker, and any interview already uploaded can keep their questions. The storage format already matches the request. The work is documentation and the review screen, not a new database.
- **B. Allow only single-choice, checkbox, and one free-text type. Reject the others at upload.** This breaks the starter and any live file that uses a rating, a number, or a date. It needs an inventory of production manifests before anyone ships it.
- **C. Build an in-app question editor for those three, and leave the HTML format unchanged.** Two ways to author the same interview. The checker stops being the source of truth the day the editor writes a different shape.

### 2. Free text is two types today. Which do we keep?

- **A. Keep `text` for one line and `longtext` for a paragraph.** Recommended. A name and a written answer are different controls, and the limits (500 vs 20,000) already stop a paragraph from landing in a one-line field by accident.
- **B. One free-text type, with `maxLength` choosing the size.** Simpler docs, and every existing `text` or `longtext` question has to be rewritten or still accepted as an alias. An alias is how B turns back into A.
- **C. Paragraphs only.** Short answers get a large box they do not need, and current `text` questions fail the checker.

### 3. Does an answer have a correct value?

- **A. No. The host reads what the person said. Progress means "they answered," not "they scored."** Recommended. That is the product that is deployed. Free text has no honest automatic key. A checkbox has many defensible "right" sets, and picking one would be a silent policy.
- **B. Optional key on single-choice and checkbox, visible only to the host. Free text is always "read it," never auto-marked. The candidate sees no score.** Use this if a host sometimes needs a marked question inside an interview. Exact set match for checkboxes, not partial credit, so one rule is explainable.
- **C. A quiz: score the candidate, including keyword marks on free text, and show the result.** This changes submit, the email, and the respondent screen. It should be its own project after A or B has been live.

### 4. How should IMAP be used?

- **A. SMTP sends the invite. Store sent or failed from Gmail's SMTP reply. Leave IMAP out of this release.** Recommended. The host and the agent can already see whether the send was accepted. An open IMAP session does not fit Vercel, and the mailbox contains more than KQA mail.
- **B. SMTP now, plus a narrow bounce check later: connect, search for a delivery notice about our message id, disconnect, return delivered, bounced, or unknown.** Reasonable as phase 4. It must not list the inbox.
- **C. Let the agent read the mailbox over IMAP.** That exposes every message in the account to anyone holding the MCP token. It is not required to send or to see interview status.

### 5. Which emails exist?

- **A. The invite with the private link, and nothing else.** Recommended. It is the email the screens already tell the host to send. There is no score to mail, and a submission receipt can wait until someone asks.
- **B. The invite, plus a short "we have your answers" note to that person when they submit.** Comforting, and it is a second template, a second trigger, and a second way to email the wrong person if the address was typed badly.
- **C. The invite, plus an email to the host when someone submits.** The host already has the answers screen and exports. Mail duplicates that and pages them for every save that becomes a submit.
- **D. All of the above.** More moving parts on the first mail release. Ship A, add B or C when a real workflow needs them.

### 6. Who is allowed to send?

- **A. The People screen and the MCP tool, both calling one function.** Recommended. A host who is not in an agent still has the button. An agent does not have to drive the browser. One function means one template and one failure log.
- **B. MCP only. The screen keeps copy-link.** Matches the sentence "the user via MCP must be able to trigger send," and leaves the host clicking around in an agent for a one-person send. The button is small once the function exists.

### 7. How does an agent prove it may change production data?

- **A. One new secret, `KQA_MCP_TOKEN`, sent as a bearer token. It can read and write. It is not the admin password.** Recommended. One value to put in the agent config and in Vercel. The admin login stays for the browser. Failed attempts are throttled.
- **B. Two tokens, one read-only and one read-write.** Safer if an agent only drafts and another agent sends. Two secrets to rotate, and every tool must declare which door it uses. Worth it only if a read-only agent will actually be deployed.
- **C. Reuse the admin cookie.** Agents do not hold that cookie reliably, and `sameOrigin` would block them. Sharing `ADMIN_PASSWORD` with every agent config is worse than a dedicated token.

### 8. Checkbox questions that are required: what counts as answered?

- **A. At least one ticked option.** Recommended. This is already how submit works. It matches "tick all that apply" when the honest answer might be a single option.
- **B. At least one, and the author may also set a minimum and a maximum.** Useful for "pick exactly three." It is a new manifest field, new checker codes, and new submit copy. Do it only if a live questionnaire needs it. It is not required for the three types to work.
- **C. A required checkbox is answered only when every option is ticked.** That is a different question ("confirm each item"), and it will block submit for ordinary multi-select surveys.

---

## 11. What this review could not verify

- Production and preview environment variables on Vercel. Local `.env` has the SMTP and IMAP names. `.env.example` does not. The app does not read them. It is unknown whether Vercel has them.
- The Gmail mailbox: whether IMAP is enabled, whether the app password is still valid, and today's sending quota. No message was sent.
- Which question types are actually stored in the live Mongo database. The code accepts eight types. The data might be mostly `single`. Treat narrowing (decision 1 option B) as unsafe until someone lists `manifest.questions[].type` on `survey_versions`.
- `graphify-out/` is not in the repo, so there was no graph to query.
- A live browser pass of the current UI was not part of planning. The interaction described in section 6 is from the components as they are written.

---

## QC review

Spot-check on 2026-11-13 against the repo. No product code. SMTP passwords were not copied.

### Confirmed claims

- Eight types in `src/lib/format/schema.ts`: `single`, `multi`, `select`, `text`, `longtext`, `number`, `scale`, `date`. `docs/template/starter.kqa.html` uses all eight. No answer key or score on the question schema. `isAnswered` treats a required checkbox as answered when the array is non-empty. `KQA701` is a warning; `withCompat` does not clear a passing survey, so a type change does not block upload.
- No `email` on `ParticipantDoc`. No mail send, no SMTP or IMAP package in `package.json`. `src/lib/env.ts` does not read mail variables. `.env.example` lists the five app variables only. Local `.env` is gitignored and defines `SMTP_HOST` (`smtp.gmail.com`), `SMTP_PORT` (`587`), `IMAP_HOST` (`imap.gmail.com`), `IMAP_PORT` (`993`), `SMTP_USER`, and `SMTP_PASSWORD`, plus the Mongo names. The app never reads the mail names.
- No `/api/mcp` route. `/_next/mcp` is the Next.js dev-server endpoint in `node_modules/next/dist/docs/01-app/02-guides/mcp.md` (`get_errors`, `get_routes`, and the other dev tools). It is not a product API.
- People are a name, an optional note (stored up to 1,000 characters), and a token. The respondent URL is `/{token}` (`src/app/[token]/page.tsx`). One-person create inserts "Respondent". `POST .../people` returns 400 in one-person mode. The admin home says "Send every person their own private link."
- Host cookie is `kqa_admin`, HMAC, 12 hours, httpOnly. `src/proxy.ts` matches only `/admin/:path*` and `/api/admin/:path*`. Admin mutations go through `guardAdmin({ mutating: true })`, which checks `sameOrigin`.
- The MCP tool list covers the host mutations on the admin routes (list, create, update, delete with the typed name, check, new version, people, reopen, new token, export, answers, events). The unsaved preview `POST /api/admin/frame` changes nothing and is correctly left out. `deleteInterview` also deletes `events`.
- Docs files named in section 7 are the docs tree. `Referrer-Policy` is already `no-referrer`. There is no `vercel.json`. `.vercel/project.json` names the project `kqa`. `graphify-out/graph.json` is absent.

### Incorrect claims

- `src/components/InterviewView.tsx` does not say "copy and send however you like." The multi-user callout says each person gets a private link. The one-person card says "Anyone with this link can answer, so send it only to the person it is meant for."
- `src/app/page.tsx` does not say "send every person their own private link." It says "Open the link your host sent you" and tells the respondent to paste the link. That sentence is on `src/app/admin/(shell)/page.tsx`.
- The `schema.ts` file comment does not mention a link. The `ParticipantDoc` comment says the token is the secret in the link. Neither tells a host to send it.
- Not every admin handler calls `guardAdmin`. Login and logout use `sameOrigin` only. `GET` and `POST /api/admin/frame` use `adminSession()`. The frame `POST` skips the origin check on purpose.
- The SBC internal file says "The platform never infers or scores gender." It does not say the product has no scores. The schema still has no key and no score.
- There is no drift test. `npm run docs` writes `docs/DIAGNOSTICS.md` and `docs/kqa-manifest.schema.json`. Nothing under `tests/` compares them. Hand-editing those files does not fail `npm test`.
- `next.config.ts` skips the frame-deny header for `/api/frame`, `/api/admin/frame`, and `/api/docs`, not only the questionnaire frames.
- The 10-second Hobby and 60-second Pro figures are not in `node_modules/next/dist/docs/`. `maxDuration.md` only says the platform enforces the number. This project's plan was not checked.
- Section 9 says a wider matcher would 302 `/api/mcp` to login. `src/proxy.ts` returns 401 JSON for any `/api/` path. That still runs before the bearer check.

### Extra decisions

These are not covered by the eight questions. The build contradicts itself until they are chosen.

**9. Which host is written into the link?** Section 5.4 uses the browser origin for the button and `KQA_PUBLIC_URL` for MCP. A preview or localhost button would email a host that disappears.

- **A. Always `KQA_PUBLIC_URL`, for the button and for MCP. If it is unset, refuse to send.** Recommended.
- **B. Button uses the browser origin. MCP uses `KQA_PUBLIC_URL`.**
- **C. Use the browser origin only when it equals `KQA_PUBLIC_URL`. Otherwise refuse.**

**10. When does "Sent" stop being true?** The mail row stores `to` and the token is the credential. Section 6.3 still shows "Sent" after later edits. Regenerating the token kills the URL that was mailed. Changing the address means the new address has not been mailed.

- **A. "Sent" matches the address and token that were mailed. Changing the email or regenerating the link sets the row back to not sent. Keep the old mail rows. Do not send automatically.** Recommended.
- **B. Leave "Sent" until someone clicks send again.**
- **C. Changing the email or the token sends the new link immediately.**

**11. How many SMTP conversations in one function call?** Section 2.7 says one send fits the timeout and a loop does not. Sections 4.3 and 5.5 allow 20 people in one call.

- **A. One person per call. The button sends that row. An agent that has many people calls once per person.** Recommended.
- **B. Up to 20 sequential sends in one invocation.**
- **C. The client may ask for many ids, and the server still performs one send per invocation.**

**12. Does a bad MCP token touch Mongo?** Section 4.2 says 401 with no database call, and also says to rate-limit through `login_attempts`, which is a Mongo write.

- **A. 401 and no Mongo call. Do not use `login_attempts` on `/api/mcp`. The token is at least 32 bytes.** Recommended.
- **B. Write `login_attempts` on failure, same as the password form, then 401.**
- **C. Rate-limit outside the function (Vercel firewall). The function still does not touch Mongo.**

Not further questions: `deleteInterview` must also delete `mail_messages`. Store the parsed address, not the raw `Name <email>` line. "No email" and "interview closed" are refusals, not `failed` mail rows. Do not treat the missing drift test as a safety net. In the README deploy paragraph, "private link" means Atlas networking, not the respondent URL.
