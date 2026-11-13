# KQA

Host-run interviews. Upload a self-contained HTML questionnaire, send each person a private link, and keep every answer in MongoDB as they type. Review and export everything from one place.

| Portal | Address | For |
|---|---|---|
| Respondent | `https://{base_url}/{token}` | The person answering. No account. Autosaves. Submit locks it |
| Host | `https://{base_url}/admin` | Create interviews, upload files, add people, review answers, export |

## Why it exists

Interactive HTML questionnaires are great to design but lose answers when they keep state in the browser. KQA keeps the design and moves the state to a database. The HTML runs exactly as designed inside a sandboxed frame; a small runtime binds its controls to the answer store.

## The format, for people and for AI agents

Everything an agent needs to write a file that KQA accepts is in [`docs/`](docs):

| File | What it is |
|---|---|
| [`docs/FORMAT.md`](docs/FORMAT.md) | The specification: manifest schema, control bindings, runtime API, sandbox limits, what is stored |
| [`docs/AGENT_PLAYBOOK.md`](docs/AGENT_PLAYBOOK.md) | The procedure an agent follows, the fix loop with the checker report, a prompt to paste |
| [`docs/DIAGNOSTICS.md`](docs/DIAGNOSTICS.md) | Every checker code, why it matters, how to fix it (generated) |
| [`docs/kqa-manifest.schema.json`](docs/kqa-manifest.schema.json) | JSON Schema of the manifest (generated) |
| [`docs/template/starter.kqa.html`](docs/template/starter.kqa.html) | A known-good file with every question type and the standard design kit |
| [`docs/examples/`](docs/examples) | Real questionnaires converted to the format |

In the app, **Format guide** has a one-click **Copy everything for an AI agent** button, and `/api/docs/bundle.md` serves the same bundle as a single markdown document an agent can fetch.

## The checker

Every upload is checked before anything is created. It reports errors, warnings and notes with a stable code, line and column, the offending source, a plain-language fix and a did-you-mean suggestion. **Copy for AI agent** produces a report written to be pasted straight back to the agent that wrote the file.

* In the app: **Check a file** (nothing is saved) or the upload step when creating an interview or replacing a version.
* Live check: in the browser the app also loads the file in a real sandboxed frame, drives every control the way a person would, hands the saved answers back, and confirms the page shows them.
* From a terminal: `npm run check -- file.html` (`--agent` for the report, `--json` for the full result).
* Replacing a file that already has answers adds a compatibility diff (removed questions, changed types, removed options).

## Run it locally

```bash
npm install
cp .env.example .env     # then fill in MONGODB_URI
npm run dev              # http://localhost:3000
```

In development the host login falls back to `admin@axion.local` / `12345678`. In production the three variables below are required and there are no fallbacks.

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string. Required |
| `MONGODB_DB` | Database name. Default `kqa` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The host login. Required in production |
| `SESSION_SECRET` | Signs the admin session cookie. Required in production. `openssl rand -base64 32` |

## Commands

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Unit tests (checker, validation, exports) |
| `npm run typecheck` | TypeScript |
| `npm run check -- file.html` | Run the checker from the terminal |
| `npm run docs` | Regenerate `DIAGNOSTICS.md` and the JSON Schema from code |
| `npm run e2e -- <baseUrl> <token> <outDir>` | Real-Chrome end-to-end run of a respondent link |
| `npm run shots -- <baseUrl> <outDir> <interviewId> [dark]` | Screenshots of the host area for review |

`e2e` and `shots` use `puppeteer-core` with your installed Chrome (`CHROME_PATH` to override).

## How it is built

* Next.js 16 (App Router, TypeScript), React 19, plain CSS design tokens, IBM Plex.
* MongoDB (Atlas) with the official driver. Collections: `interviews`, `survey_versions` (immutable per upload), `participants` (token, status, answers keyed by question id), `events` (audit, 180-day TTL), `login_attempts` (throttling, 30-minute TTL).
* One definition of the format (`src/lib/format/schema.ts`, zod) feeds the checker, the answer validation, the JSON Schema and the docs, so they cannot drift.
* Exports: Excel workbook, CSV (one row per person, or one per answer), Markdown report, JSON.

### Security model

* Uploaded HTML is untrusted. It runs in an iframe with `sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"` (no same-origin) and a strict Content-Security-Policy that blocks network calls, framing and form posts. It can only talk to the app with `postMessage`, and the app accepts messages only from its own frame.
* Respondent links carry a 144-bit random token. Tokens are the credential, so keep links private. A host can issue a new link for a person at any time.
* The host area uses an HMAC-signed, httpOnly, same-site cookie, checks the request origin on every mutating call, and throttles failed logins.
* Every answer is validated against the manifest on the server before it is stored.
* `/admin` currently has one shared credential. Per-host accounts are planned.

## Deploying

Vercel. Set the five environment variables above, make sure the Atlas network access list allows Vercel (Atlas **Network Access**, allow `0.0.0.0/0` or use a private link), then `vercel --prod`.
