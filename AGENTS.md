<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## KQA

This app hosts interviews. Questionnaires are HTML files (`docs/AGENT_PLAYBOOK.md`, `docs/FORMAT.md`): single choice, checkboxes, short text, paragraphs, and also dropdown, number, scale, and date. There is no in-app question builder and no scoring.

Host actions for a live interview go through the MCP server in `docs/MCP.md` at `POST /api/mcp`, with a `KQA_MCP_TOKEN` bearer. `/_next/mcp` is the Next.js dev diagnostics endpoint and does not operate interviews.
