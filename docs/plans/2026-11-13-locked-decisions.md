# Historical decisions — 2026-11-13

Status: archival snapshot of decisions made on 2026-11-13. The implementation has since evolved; consult current product docs and source before relying on a detail below.

> **Archive notice (reviewed 2026-11-19):** This file is not a current policy or release checklist. It captures a point-in-time resolution of choices in the historical plan [`2026-11-13-question-types-mcp-email.md`](2026-11-13-question-types-mcp-email.md). Current authoritative guides are [`README.md`](../../README.md), [`FORMAT.md`](../FORMAT.md), [`MCP.md`](../MCP.md), [`DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md), and [`INTERVIEW_PACKAGES.md`](../INTERVIEW_PACKAGES.md). Confirm sensitive behavior against the implementation before operating the service.

## Product decisions

1. **Question types.** Keep all eight: `single`, `multi`, `text`, `longtext`, `select`, `number`, `scale`, `date`. Docs lead with single choice, checkboxes, and both free-text controls, and still list the others. There is no in-app question builder. The HTML file stays the format.
2. **Free text.** Keep `text` (one line, existing max length) and `longtext` (paragraph, existing max length).
3. **Scoring and selection bounds.** No answer key, points, or candidate-facing score. "Answered" is a non-empty value. A required checkbox is answered when at least one option is ticked. Multi-select may optionally set `maxSelections`; it does not set a minimum. Whitespace-only text is empty.
4. **Email.** Optional on a person. The host can add or edit it. If it is present, the host can send one fixed invite (People screen and MCP, one shared function) containing the person's name, the interview title, and their private link. The questionnaire HTML is not in the email. If there is no email, send is unavailable and copy-link remains. No submission receipt and no mail to the host.
5. **Who sends.** The People screen and the MCP tool call `sendInvite` in `src/lib/mail/invite.ts`.
6. **Transport.** SMTP on port 587 with STARTTLS, using `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASSWORD`. Bounce check is on demand: IMAP on port 993 (`IMAP_HOST`, `IMAP_PORT`, same user and password), search only message ids stored at send time, return delivered, bounced, or unknown, then disconnect. No mailbox watcher and no general mailbox read.
7. **MCP auth.** `KQA_MCP_TOKEN` bearer, read-write. Not the admin password and not the admin cookie. Missing or wrong token is 401.
8. **MCP surface.** Stateless Streamable HTTP at `POST /api/mcp`. Not `/_next/mcp`. Tools cover the host controls that already exist, plus invite send and delivery check. Documented in `docs/MCP.md`.

## Locked send rules

These four were open choices in the plan. They are locked.

1. **Link host.** Invite emails always use `KQA_PUBLIC_URL`. If it is unset, send is refused and no mail row is written. The People screen copy-link still uses the address the host is looking at. Lives in `src/lib/mail/policy.ts` (`inviteLink`).
2. **When "Sent" is true.** Only for the exact address and the exact token that were mailed. Editing the email or rotating the link clears the current sent state, keeps the mail rows, and does not send again. Lives in `src/lib/mail/state.ts` (`currentMail`).
3. **Batch size.** One SMTP send per call. The People button and `send_invite` each take one person. No bulk send. `sendInvite` accepts a single `personId`, and the MCP tool rejects `personIds`.
4. **Bad MCP token.** HTTP 401 and no Mongo call. `login_attempts` is not written for `/api/mcp`. Lives in `src/lib/mcp/auth.ts`, which does not import the database. The route calls it before any tool.

## Also required

- `deleteInterview` deletes that interview's `mail_messages`. Removing a person deletes theirs too.
- Stored email is the parsed address, not the raw `Name <email>` line.
- "No email", "interview closed", and unset `KQA_PUBLIC_URL` are refusals. They do not write a failed mail row.
- One-person interviews show send on the overview link card, not only on the people table.
- The invite subject is `{person name} — {interview title}` so clients do not thread every invite together.
- No React question renderer. Questions stay in the uploaded HTML.
- `GET /api/p/[token]` records "opened their link" only when the respondent app sends `X-KQA-Client: respondent` and the request is not a prefetch or a known preview agent. Status stays "Not started" until a save. The first-load error no longer says answers are safe before anything is stored. Submit-lock copy is unchanged.

## Production environment

Names only. Production Vercel needs `KQA_MCP_TOKEN`, `KQA_PUBLIC_URL`, `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASSWORD`, `IMAP_HOST`, and `IMAP_PORT` (993), plus the existing Mongo and admin variables.

This change did not run `vercel env`. The CLI would risk printing the SMTP password or the new token into a log. A person should set those names in the Vercel project for `kqa` without echoing the values.

## Where the behaviour lives

| Behaviour | File |
|---|---|
| Invite template and the one send | `src/lib/mail/invite.ts`, `src/lib/mail/template.ts` |
| SMTP | `src/lib/mail/smtp.ts` |
| IMAP bounce check | `src/lib/mail/imap.ts`, `src/lib/mail/dsn.ts` |
| People screen and overview card | `src/components/InviteActions.tsx`, `src/components/PeopleTab.tsx`, `src/components/InterviewView.tsx` |
| MCP | `src/app/api/mcp/route.ts`, `src/lib/mcp/` |
