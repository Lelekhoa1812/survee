<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## KQA

This app hosts interviews. Questionnaires are HTML files (`docs/AGENT_PLAYBOOK.md`, `docs/FORMAT.md`): single choice, checkboxes, short text, paragraphs, dropdown, number, scale, date, and full-order ranking of 2–8 options. Rank answers are complete ordered permutations; KQA does not score answers or rank people. The format also supports bounded `when` routing by earlier choice comparisons or by whether an earlier answer is present. Requiredness and progress apply only while a question is eligible, and answers to questions that become inactive are retained. There is no in-app question builder. Read the format and playbook before authoring or editing questionnaires.

Host actions for a live interview go through the MCP server in `docs/MCP.md` at `POST /api/mcp`, with a bearer that is either `KQA_MCP_TOKEN` or an active key from Settings. `/_next/mcp` is the Next.js dev diagnostics endpoint and does not operate interviews.
