# KQA

Host-run interviews. Upload an HTML questionnaire with optional reusable workspace images, email or copy each person a private link, and keep every answer in MongoDB as they type. Review individual answers, inspect descriptive summaries, and export the results from one place. The file supports single choice, checkboxes, short and long text, dropdown, number, scale, date, and full-order ranking of 2–8 options; choice answers and whether an answer is present can drive declarative conditional follow-ups. KQA does not score answers or rank people.

| Portal | Address | For |
|---|---|---|
| Respondent | `https://{base_url}/{token}` | The person answering. No account. Autosaves while online; section-aware question navigation and answer clearing in pre-submit review support respondent control. Keep the page open until **Saved** after reconnecting. Submit locks it |
| Host | `https://{base_url}/admin` | Create interviews, upload files, add people, refresh live progress snapshots, analyze response patterns, review answers, export |

## Why it exists

Interactive HTML questionnaires are great to design but lose answers when they keep state in the browser. KQA keeps the design and moves the state to a database. KQA renders the authored questionnaire in a sandboxed frame, subject to the format's documented sandbox limits; a small runtime binds its controls to the answer store.

## The format, for people and for AI agents

Everything an agent needs to write a file that KQA accepts is in [`docs/`](docs):

For contributors, [`docs/README.md`](docs/README.md) maps current source-of-truth docs to implementation and describes how to keep the guides synchronized.

| File | What it is |
|---|---|
| [`docs/FORMAT.md`](docs/FORMAT.md) | The specification: manifest schema, control bindings, runtime API, sandbox limits, what is stored |
| [`docs/AGENT_PLAYBOOK.md`](docs/AGENT_PLAYBOOK.md) | The procedure an agent follows, the fix loop with the checker report, a prompt to paste |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | Sourced design, accessibility, interaction, analytics and usability review standards |
| [`docs/INTERVIEW_PACKAGES.md`](docs/INTERVIEW_PACKAGES.md) | 18 versioned, addressable industrial, public-service, research and personal starting packages with risk safeguards |
| [`docs/QUESTION_BLUEPRINT.md`](docs/QUESTION_BLUEPRINT.md) | Reusable per-question purpose, interpretation, routing and test record |
| [`docs/kqa-questionnaire-author/SKILL.md`](docs/kqa-questionnaire-author/SKILL.md) | Portable Agent Skills workflow for questionnaire design and live updates |
| [`docs/DIAGNOSTICS.md`](docs/DIAGNOSTICS.md) | Every checker code, why it matters, how to fix it (generated) |
| [`docs/kqa-manifest.schema.json`](docs/kqa-manifest.schema.json) | JSON Schema of the manifest (generated) |
| [`docs/template/starter.kqa.html`](docs/template/starter.kqa.html) | A known-good file with every question type and the standard design kit |
| [`docs/examples/`](docs/examples) | Runnable feature examples plus clearly labeled, illustrative service-improvement and personal-planning questionnaires with review records; examples are not validated instruments |
| [`docs/MCP.md`](docs/MCP.md) | How an agent operates a live interview (not how to write the HTML) |
| [`docs/evals/QUESTIONNAIRE_AUTHORING_BENCHMARK.md`](docs/evals/QUESTIONNAIRE_AUTHORING_BENCHMARK.md) | Reproducible review cases, scoring contract and evidence limits |
| [`docs/evals/PACKAGE_SELECTION_BENCHMARK.md`](docs/evals/PACKAGE_SELECTION_BENCHMARK.md) | Development-only package-fit, clarification and boundary evaluation |
| [`docs/evals/PACKAGE_DRAFT_BENCHMARK.md`](docs/evals/PACKAGE_DRAFT_BENCHMARK.md) | Independent expert review of complete package-based questionnaire drafts, with separate evidence lanes |

In the app, **Format guide** has a one-click **Copy everything for an AI agent** button, and `/api/docs/bundle.md` serves the same bundle as a single markdown document an agent can fetch.

## The checker

Every upload is checked before anything is created. It reports errors, warnings and notes with a stable code, line and column, the offending source, a plain-language fix and a did-you-mean suggestion. **Copy for AI agent** produces a report written to be pasted straight back to the agent that wrote the file.

* In the app: **Check a file** (nothing is saved) or the upload step when creating an interview or replacing a version.
* Live check: in a hidden sandboxed frame, the app programmatically sets standard bound controls to sample values and checks that the runtime records and restores them. For custom questions without native bound controls, it calls `KQA.set` and checks for a visible page mutation. This smoke test does not simulate real pointer/keyboard use, routing end to end, submission/locking, accessibility, or usability.
* From a terminal: `npm run check -- file.html` (`--agent` for the report, `--json` for the full result).
* Replacing a file that already has answers adds a compatibility diff (removed questions, changed types, removed options).

## Run it locally

```bash
npm install
cp .env.example .env     # then fill in MONGODB_URI
npm run dev              # http://localhost:3000
```

In development the legacy Axion owner login falls back to `admin@axion.local` / `12345678`. New accounts sign up with a workspace name, a deliverable email address and a password; email verification is required before sign-in. In production, the legacy owner bootstraps once with the configured credentials, then can change the `.local` email to a verified address in Settings.

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | Required MongoDB Atlas or replica-set URI; respondent saves and questionnaire publishing require transactions |
| `MONGODB_DB` | Database name. Default `kqa` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Initial Axion owner bootstrap credential. Required in production; regular accounts use their own passwords |
| `SESSION_SECRET` | Signs the admin session cookie. Required in production. `openssl rand -base64 32` |
| `KQA_PUBLIC_URL` | Public origin used in invite emails, such as `https://your-host`. Required to send. The copied link on screen can still be the address you are visiting |
| `KQA_MCP_TOKEN` | Optional Axion-bound service bearer for `POST /api/mcp`. Named keys created in Settings are also accepted and scoped to their workspace. Not the admin password. `openssl rand -base64 32` |
| `KQA_MCP_ALLOWED_ORIGINS` | Optional comma-separated cross-origin browser MCP origins (`https://client.example`). `KQA_PUBLIC_URL` is trusted too. Requests without an `Origin` header remain supported for server-to-server clients |
| `KQA_AXION_LEGACY_TENANT_FALLBACK` | Defaults to enabled for Axion data during migration. After a reviewed backfill and a zero-unscoped audit, set to `false` and redeploy to enforce strict tenant filters |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | Optional email delivery for interview invites, account verification, email changes and password resets. `SMTP_PORT` defaults to 587 with STARTTLS. The password is never written into the repo |
| `IMAP_HOST` | Optional on-demand invite delivery check. `IMAP_PORT` defaults to 993 and uses the same `SMTP_USER` and `SMTP_PASSWORD` |

## Commands

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Unit tests (checker, validation, exports) |
| `npm run typecheck` | TypeScript |
| `npm run check -- file.html` | Run the checker from the terminal |
| `npm run docs` | Regenerate diagnostics, the manifest JSON Schema, and the portable author skill's reference copies |
| `npm run a11y:audit` | Audit public pages at responsive widths with axe-core and the installed Chrome; see `docs/DESIGN_SYSTEM.md` for scope and limits |
| `npm run audit:tenant-migration` | Run the owner-only Axion tenant migration audit; review its output before changing the legacy-fallback setting |
| `npm run e2e -- <baseUrl> <token> <outDir>` | Real-Chrome end-to-end run of a respondent link |
| `npm run e2e:offline -- <baseUrl> <token>` | Offline, refusal, concurrency-window and submit checks against a disposable respondent |
| `npm run e2e:concurrency -- <baseUrl> <token>` | Concurrent answer-write check against a disposable respondent |
| `npm run e2e:security -- <baseUrl> [email] [password]` | Black-box auth, origin and request-size checks; add `--throttle` only on a disposable local account |
| `npm run e2e:probe -- [baseUrl]` | Browser checks for live questionnaire diagnostics |
| `npm run shots -- <baseUrl> <outDir> <interviewId> [light|dark] [all|analysis|accounts]` | Screenshots of host, analysis or account surfaces for review |
| `npm run shots:states -- <baseUrl> <outDir> <interviewId> <respondentToken> [light|dark]` | Screenshots of diagnostic and interview states |

The respondent E2E, offline, concurrency, security and state-screenshot checks can change answer data, submit respondents, revoke test sessions or create interviews. They reject remote targets by default and assume a disposable local database. For an explicitly disposable HTTPS test deployment, set `KQA_E2E_ALLOW_REMOTE_MUTATIONS=1` and `KQA_E2E_CONFIRM_ORIGIN` to the exact origin; the primary `kqa-bay.vercel.app` host also requires `KQA_E2E_ALLOW_PRODUCTION_MUTATIONS=1`. Never point these checks at real respondents. `e2e` and screenshot commands use `puppeteer-core` with your installed Chrome (`CHROME_PATH` to override).

## How it is built

* Next.js 16 (App Router, TypeScript), React 19, plain CSS design tokens, IBM Plex.
* MongoDB (Atlas) with the official driver. Tenant-owned collections include `interviews`, `survey_versions` (immutable per upload), `participants` (token, optional email, status, answers keyed by question id), `mail_messages` (invite send and delivery, never the message body), `events` (audit, 180-day TTL), and `api_keys` (name, note, hash, fingerprint, expiry, revoke). Accounts use `tenants`, `users`, `memberships`, and expiring signup, email-change and password-reset token collections.
* The format definition (`src/lib/format/schema.ts`, Zod) feeds the checker, answer validation, and JSON Schema. `scripts/gen-docs.ts` generates `docs/kqa-manifest.schema.json`, `docs/DIAGNOSTICS.md`, and path-preserving reference copies under `docs/kqa-questionnaire-author/references/`. Edit canonical docs, examples, and templates, then run `npm run docs`; do not edit generated copies directly.
* Exports: Excel workbook, CSV (one row per person, or one per answer), Markdown report, JSON.

### Security model

* Uploaded HTML is untrusted. It runs in a sandboxed iframe with a strict Content-Security-Policy that blocks network calls, remote images, framing and form posts. Stored same-origin KQA image URLs are allowed so a questionnaire can show workspace images. The page can only talk to the app with `postMessage`, and the app accepts messages only from its own frame.
* Respondent links carry a 144-bit random token. Tokens are the credential, so keep links private. The link in an invite email is that credential. A host can issue a new link for a person at any time; the mailed link then stops working and is not sent again on its own.
* One verified account can join several workspaces through emailed invitations and switch between active memberships from the host navigation. Owners and admins can revoke workspace memberships; an owner is required to remove another owner, and the last owner is protected. Removal leaves the account and other workspace memberships intact, while workspace sessions and linked OAuth access stop working. Each session is bound to one workspace; passwords use salted scrypt hashes, sessions are HMAC-signed, httpOnly and same-site, check persisted membership and credential version, and expire after 12 hours. Mutating calls check request origin; login, signup, email changes and password resets are throttled.
* Agents use `POST /api/mcp` with `Authorization: Bearer`. The server accepts `KQA_MCP_TOKEN` for Axion or a tenant-scoped key from Settings. That credential is not the admin password and not the session cookie. A missing bearer is rejected before the database is touched. See [`docs/MCP.md`](docs/MCP.md). `/_next/mcp` is only the Next.js development diagnostics endpoint.
* Every answer is validated against the manifest on the server before it is stored.
* Analysis routes send aggregate summaries to the browser without respondent names, emails, links, notes or raw answer values. Individual answers are loaded only in the detail views.

## Deploying

Deploy to Vercel after setting the core variables `MONGODB_URI`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `SESSION_SECRET`. Add `KQA_PUBLIC_URL` and SMTP settings when invite/account email is enabled; add `IMAP_HOST` for on-demand invite delivery checks. `KQA_MCP_TOKEN` is optional when named workspace keys from Settings are used; set it only when the Axion-bound service credential is needed. For Atlas access, prefer a private connection or the narrowest allowlist that fits the deployment. Review the owner-only Axion data audit and verify a current database backup before assigning tenant IDs. After the backfill completes and the audit reports zero unscoped owned records, set `KQA_AXION_LEGACY_TENANT_FALLBACK=false` in Vercel and redeploy to make Axion filters strict; setting it earlier hides untagged legacy records. Do not put the SMTP password or the MCP token in the repository.
