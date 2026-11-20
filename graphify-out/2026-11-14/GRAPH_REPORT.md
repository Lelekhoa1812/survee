# Graph Report - kqa  (2026-11-14)

## Corpus Check
- 127 files · ~125,463 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1039 nodes · 2311 edges · 66 communities (62 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `13a2baa4`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- repo/index.ts
- fail
- rows.ts
- mcp/http.ts
- invite.ts
- report.ts
- ui.tsx
- offline-e2e.mjs
- p/[token]/route.ts
- PeopleTab.tsx
- InterviewView.tsx
- Controls and bindings (KQA3xx, KQA4xx)
- package.json
- compilerOptions
- The manifest (KQA2xx)
- Sandbox and safety (KQA5xx)
- SettingsConsole.tsx
- static.ts
- properties
- [[...slug]]/page.tsx
- schema.ts
- api
- properties
- RespondentShell.tsx
- AI agent playbook: write a KQA questionnaire
- KQA questionnaire format (kqa/1)
- dependencies
- scripts
- Live check in the browser (KQA6xx)
- items
- app/layout.tsx
- devDependencies
- checkBindings
- 10. Decisions required before build
- KQA
- README.md
- The file itself (KQA1xx)
- 2. Current state
- checker-regressions.test.ts
- Checker codes
- Locked decisions — 2026-11-13
- 5. Email
- security-check.mjs
- checkHtml
- Replacing a survey that already has answers (KQA7xx)
- KQA production plan: question types, MCP, and email
- 3. Proposed domain model
- concurrency-check.mjs
- validateManifest
- 3. The manifest
- kqa-manifest.schema.json
- 4. MCP server
- 8. Phased build
- checker.test.ts
- 4. Binding controls
- label
- maxLength
- questions
- 6. UI and UX
- QC review
- jsonpos.ts
- AGENTS.md
- id
- step
- type

## God Nodes (most connected - your core abstractions)
1. `fail()` - 38 edges
2. `json()` - 36 edges
3. `guardAdmin()` - 30 edges
4. `api()` - 24 edges
5. `getInterview()` - 21 edges
6. `useToast()` - 20 edges
7. `parseEmail()` - 20 edges
8. `Controls and bindings (KQA3xx, KQA4xx)` - 20 edges
9. `checkHtml()` - 18 edges
10. `Manifest` - 18 edges

## Surprising Connections (you probably didn't know these)
- `post()` --calls--> `handleMcp()`  [EXTRACTED]
  tests/mcp-auth.test.ts → src/lib/mcp/http.ts
- `post()` --calls--> `handleMcp()`  [EXTRACTED]
  tests/mcp-keys.test.ts → src/lib/mcp/http.ts
- `call()` --calls--> `handleMcp()`  [EXTRACTED]
  tests/mcp-tools.test.ts → src/lib/mcp/http.ts
- `save()` --calls--> `api()`  [EXTRACTED]
  src/components/InviteActions.tsx → src/components/ui.tsx
- `Group` --references--> `Question`  [EXTRACTED]
  src/lib/export/markdown.ts → src/lib/format/schema.ts

## Import Cycles
- None detected.

## Communities (66 total, 3 thin omitted)

### Community 0 - "repo/index.ts"
Cohesion: 0.05
Nodes (94): mongodb, dynamic, generateMetadata(), InterviewPage(), GET(), Ctx, DELETE(), GET() (+86 more)

### Community 1 - "fail"
Cohesion: 0.08
Nodes (59): dynamic, LoginPage(), metadata, dynamic, ShellLayout(), POST(), Ctx, POST() (+51 more)

### Community 2 - "rows.ts"
Cohesion: 0.08
Nodes (63): RFC-4180, Ctx, csvLong(), csvWide(), neutraliseCell(), quoteCsv(), toCsv(), exportInterview() (+55 more)

### Community 3 - "mcp/http.ts"
Cohesion: 0.06
Nodes (43): vitest, dynamic, JSON_HEADERS, maxDuration, POST(), mcpToken(), authorizeMcp(), tokensMatch() (+35 more)

### Community 4 - "invite.ts"
Cohesion: 0.07
Nodes (43): RFC-822, imapflow, dynamic, metadata, SettingsPage(), imapSettings(), publicBaseUrl(), smtpSettings() (+35 more)

### Community 5 - "report.ts"
Cohesion: 0.10
Nodes (28): args, files, out, root, TITLES, BY_CODE, CATALOG, CatalogEntry (+20 more)

### Community 6 - "ui.tsx"
Cohesion: 0.12
Nodes (18): react, metadata, metadata, CheckerPanel(), Filter, SEV_BADGE, SEV_LABEL, BrandMark() (+10 more)

### Community 7 - "offline-e2e.mjs"
Cohesion: 0.07
Nodes (14): puppeteer-core, [base = "http://localhost:3100", token, out = "."], check(), log(), [base = "http://localhost:3100", token], cases, dir, starter (+6 more)

### Community 8 - "p/[token]/route.ts"
Cohesion: 0.14
Nodes (17): GET(), POST(), Ctx, GET(), Ctx, GET(), metadata, RespondentPage() (+9 more)

### Community 9 - "PeopleTab.tsx"
Cohesion: 0.17
Nodes (16): DELIVERY, InviteActions(), PersonEmailEditor(), save(), NewInterview(), AddPeople(), onPaste(), EditPerson() (+8 more)

### Community 10 - "InterviewView.tsx"
Cohesion: 0.15
Nodes (13): AnswersTab(), STATUS, ExportTab(), FORMATS, EventRow, InterviewData, PersonMail, PersonRow (+5 more)

### Community 11 - "Controls and bindings (KQA3xx, KQA4xx)"
Cohesion: 0.10
Nodes (20): Controls and bindings (KQA3xx, KQA4xx), KQA300: Question has no control in the page, KQA301: Control refers to an unknown question, KQA302: Control type does not match the question type, KQA303: Option value in the page is not in the manifest, KQA304: Manifest option has no control in the page, KQA305: Note control refers to an unknown question, KQA306: Question enables a note but has no note field (+12 more)

### Community 12 - "package.json"
Cohesion: 0.11
Nodes (18): description, engines, node, name, private, version, exceljs, jsdom (+10 more)

### Community 13 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 14 - "The manifest (KQA2xx)"
Cohesion: 0.11
Nodes (18): KQA200: Manifest missing, KQA201: More than one manifest, KQA202: Manifest is not valid JSON, KQA203: Manifest field has the wrong shape, KQA204: Unsupported format version, KQA205: No questions, KQA206: Invalid question or section id, KQA207: Duplicate question id (+10 more)

### Community 15 - "Sandbox and safety (KQA5xx)"
Cohesion: 0.11
Nodes (18): KQA400: Script loads from a blocked source, KQA401: Stylesheet or font loads from a blocked source, KQA402: Network call in script, KQA403: Browser storage used, KQA404: Modal dialog used, KQA405: Form submits to a URL, KQA406: Meta refresh, KQA407: <base> element (+10 more)

### Community 16 - "SettingsConsole.tsx"
Cohesion: 0.15
Nodes (14): Dashboard(), dynamic, metadata, Filter, FILTERS, generateLocal(), KeyForm(), KeyRow (+6 more)

### Community 17 - "static.ts"
Cohesion: 0.12
Nodes (17): ALLOWED_SCRIPT_HOSTS, ALLOWED_STYLE_HOSTS, BCtx, CheckOptions, El, Extra, Found, MCtx (+9 more)

### Community 18 - "properties"
Cohesion: 0.12
Nodes (17): type, maxLength, type, properties, type, type, anyOf, custom (+9 more)

### Community 19 - "[[...slug]]/page.tsx"
Cohesion: 0.24
Nodes (13): marked, DocsPage(), dynamic, metadata, slugify(), Ctx, GET(), CopyBundle() (+5 more)

### Community 20 - "schema.ts"
Cohesion: 0.12
Nodes (16): FORMAT_ID, ID_RE, idString, manifestSchema, noteSchema, Option, OPTION_TYPES, OPTION_VALUE_RE (+8 more)

### Community 21 - "api"
Cohesion: 0.17
Nodes (13): AdminNav(), LINKS, EditDetails(), save(), InterviewView(), toggleStatus(), useOrigin(), LoginForm() (+5 more)

### Community 22 - "properties"
Cohesion: 0.14
Nodes (14): maxLength, type, const, type, properties, description, format, sections (+6 more)

### Community 23 - "RespondentShell.tsx"
Cohesion: 0.19
Nodes (9): PreviewFrame(), hasValue(), Loaded, Patch, Phase, RespondentShell(), SaveState, AnswerMap (+1 more)

### Community 24 - "AI agent playbook: write a KQA questionnaire"
Cohesion: 0.15
Nodes (13): AI agent playbook: write a KQA questionnaire, Converting an existing interactive HTML page, Mapping common survey shapes, Output contract, Prompt to give an agent, Step 1. Gather what you need, Step 2. Design the manifest first, Step 3. Write the markup (+5 more)

### Community 25 - "KQA questionnaire format (kqa/1)"
Cohesion: 0.18
Nodes (11): 1. How it works, 2. File rules, 5.1 Message protocol (for reference), 5. The KQA runtime, 6. What gets stored, 7. Replacing a file after people have answered, 8. The standard KQA look, 9. Pre-flight checklist (+3 more)

### Community 26 - "dependencies"
Cohesion: 0.18
Nodes (11): dependencies, exceljs, imapflow, marked, mongodb, next, nodemailer, parse5 (+3 more)

### Community 27 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, check, dev, docs, e2e, shots, start (+3 more)

### Community 28 - "Live check in the browser (KQA6xx)"
Cohesion: 0.20
Nodes (10): KQA600: Script error when the page loads, KQA601: Control did not record its answer, KQA602: Saved answer was not shown again, KQA603: Unhandled promise rejection, KQA604: Console error, KQA605: Page did not start, KQA606: Page shows nothing, KQA607: Page scrolls sideways at phone width (+2 more)

### Community 29 - "items"
Cohesion: 0.29
Nodes (10): additionalProperties, required, type, items, maxItems, minItems, type, options (+2 more)

### Community 30 - "app/layout.tsx"
Cohesion: 0.20
Nodes (7): config, next, metadata, mono, sans, viewport, ToastProvider()

### Community 31 - "devDependencies"
Cohesion: 0.20
Nodes (10): devDependencies, jsdom, puppeteer-core, tsx, @types/node, @types/nodemailer, @types/react, @types/react-dom (+2 more)

### Community 32 - "checkBindings"
Cohesion: 0.36
Nodes (10): attr(), checkBindings(), elementKind(), hasAttr(), hasGroupLabel(), hasLabel(), isEl(), kids() (+2 more)

### Community 33 - "10. Decisions required before build"
Cohesion: 0.22
Nodes (9): 10. Decisions required before build, 1. The format already has eight question types. What should this release do?, 2. Free text is two types today. Which do we keep?, 3. Does an answer have a correct value?, 4. How should IMAP be used?, 5. Which emails exist?, 6. Who is allowed to send?, 7. How does an agent prove it may change production data? (+1 more)

### Community 34 - "KQA"
Cohesion: 0.22
Nodes (9): Commands, Deploying, How it is built, KQA, Run it locally, Security model, The checker, The format, for people and for AI agents (+1 more)

### Community 35 - "README.md"
Cohesion: 0.29
Nodes (4): Connect, Deliberately absent, KQA MCP server, What the tools do

### Community 36 - "The file itself (KQA1xx)"
Cohesion: 0.25
Nodes (8): KQA100: File is empty, KQA101: File is too large, KQA102: File is not clean UTF-8, KQA103: Missing <!doctype html>, KQA110: HTML syntax problem, KQA111: Duplicate id attribute, KQA112: Unterminated element or comment, The file itself (KQA1xx)

### Community 37 - "2. Current state"
Cohesion: 0.25
Nodes (8): 2.1 Domain and storage, 2.2 How questions are authored and shown, 2.3 People and the link, 2.4 Auth and HTTP surface, 2.5 Environment and deploy, 2.6 Docs that mention question types, 2.7 Next.js 16 constraints that the build must respect, 2. Current state

### Community 38 - "checker-regressions.test.ts"
Cohesion: 0.29
Nodes (5): maskJs(), regexAllowed(), STARTER, swap(), withScript()

### Community 39 - "Checker codes"
Cohesion: 0.29
Nodes (6): Checker codes, KQA501: Missing lang attribute, KQA502: Missing viewport meta, KQA503: Missing <title>, KQA504: No <h1> or <main>, Quality notes

### Community 40 - "Locked decisions — 2026-11-13"
Cohesion: 0.29
Nodes (6): Also required, Locked decisions — 2026-11-13, Locked send rules, Product decisions, Production environment, Where the behaviour lives

### Community 41 - "5. Email"
Cohesion: 0.29
Nodes (7): 5.1 What the product is supposed to send, 5.2 SMTP and IMAP, 5.3 Env vars (names only), 5.4 Template, 5.5 Failure handling, 5.6 How an MCP client triggers send, 5. Email

### Community 42 - "security-check.mjs"
Cohesion: 0.29
Nodes (3): [base = "http://localhost:3100", email = "admin@axion.local", password = "12345678"], cookie, withThrottle

### Community 43 - "checkHtml"
Cohesion: 0.38
Nodes (7): add(), checkHtml(), contextLines(), hostOf(), offsetToLoc(), sourceLine(), str()

### Community 44 - "Replacing a survey that already has answers (KQA7xx)"
Cohesion: 0.33
Nodes (6): KQA700: Saved answers belong to a removed question, KQA701: Question type changed, KQA702: Saved answers use a removed option, KQA703: Question may have been renamed, KQA704: New required question and some people already submitted, Replacing a survey that already has answers (KQA7xx)

### Community 45 - "KQA production plan: question types, MCP, and email"
Cohesion: 0.33
Nodes (5): 11. What this review could not verify, 1. What this update actually is, 7. Documentation to update, 9. Risks, KQA production plan: question types, MCP, and email

### Community 46 - "3. Proposed domain model"
Cohesion: 0.33
Nodes (6): 3.1 The three shapes, on the types that already exist, 3.2 Scoring and correctness, 3.3 People, for email, 3.4 Mail record, 3.5 What happens to interviews already in Mongo, 3. Proposed domain model

### Community 48 - "validateManifest"
Cohesion: 0.40
Nodes (6): checkUnknownKeys(), closest(), isObj(), levenshtein(), slug(), validateManifest()

### Community 49 - "3. The manifest"
Cohesion: 0.40
Nodes (5): 3.1 Top-level fields, 3.2 Section fields, 3.3 Question fields, 3.4 Choosing a type, 3. The manifest

### Community 50 - "kqa-manifest.schema.json"
Cohesion: 0.40
Nodes (4): additionalProperties, required, $schema, type

### Community 51 - "4. MCP server"
Cohesion: 0.40
Nodes (5): 4.1 Shape, 4.2 Auth, 4.3 Tool inventory, 4.4 Errors the tools return, 4. MCP server

### Community 52 - "8. Phased build"
Cohesion: 0.40
Nodes (5): 8. Phased build, Phase 1 — Question types, docs, and review, Phase 2 — Email address and SMTP invite, Phase 3 — MCP, Phase 4 — IMAP bounce check, only if decision 4 says to include it

### Community 54 - "4. Binding controls"
Cohesion: 0.50
Nodes (4): 4.1 Notes, 4.2 Status ticks, 4.3 Custom questions, 4. Binding controls

### Community 55 - "label"
Cohesion: 0.50
Nodes (4): maxLength, minLength, type, label

### Community 56 - "maxLength"
Cohesion: 0.50
Nodes (4): maximum, minimum, type, maxLength

### Community 57 - "questions"
Cohesion: 0.50
Nodes (4): questions, maxItems, minItems, type

### Community 58 - "6. UI and UX"
Cohesion: 0.50
Nodes (4): 6.1 Authoring the file, 6.2 What the candidate sees around the file, 6.3 What the author (the host) sees, 6. UI and UX

### Community 59 - "QC review"
Cohesion: 0.50
Nodes (4): Confirmed claims, Extra decisions, Incorrect claims, QC review

### Community 60 - "jsonpos.ts"
Cohesion: 0.50
Nodes (3): JsonErr, JsonOk, parseJsonWithPositions()

### Community 62 - "id"
Cohesion: 0.67
Nodes (3): pattern, type, id

### Community 63 - "step"
Cohesion: 0.67
Nodes (3): step, exclusiveMinimum, type

### Community 64 - "type"
Cohesion: 0.67
Nodes (3): type, enum, type

## Knowledge Gaps
- **423 isolated node(s):** `$schema`, `type`, `type`, `const`, `type` (+418 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 477 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `mongodb` connect `repo/index.ts` to `mcp/http.ts`, `package.json`, `invite.ts`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `react` connect `ui.tsx` to `PeopleTab.tsx`, `InterviewView.tsx`, `package.json`, `SettingsConsole.tsx`, `api`, `RespondentShell.tsx`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `vitest` connect `mcp/http.ts` to `rows.ts`, `invite.ts`, `checker-regressions.test.ts`, `p/[token]/route.ts`, `PeopleTab.tsx`, `package.json`, `checker.test.ts`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `$schema`, `type`, `type` to the rest of the system?**
  _423 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `repo/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05254378648874062 - nodes in this community are weakly interconnected._
- **Should `fail` be split into smaller, more focused modules?**
  _Cohesion score 0.07929824561403509 - nodes in this community are weakly interconnected._
- **Should `rows.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07997038134024435 - nodes in this community are weakly interconnected._