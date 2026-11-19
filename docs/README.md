# KQA documentation map and maintenance

The docs are part of KQA's authoring and operating interface. Keep the source code, host UI, MCP tool schemas, help pages, and exported agent bundle consistent when behavior changes. The root [README](../README.md) is the setup and deployment guide; this page is for contributors maintaining project documentation.

## Current source of truth

| Topic | Primary reference | Implementation source |
|---|---|---|
| Questionnaire file, question types, routing, runtime and compatibility | [FORMAT.md](FORMAT.md) | `src/lib/format/schema.ts`, `src/lib/format/answers.ts`, `src/lib/format/bridge.ts` |
| Repeatable-record fit, constraints, respondent safeguards and evidence gates | [Repeatable-record design](kqa-questionnaire-author/references/REPEATABLE_RECORDS_DESIGN.md) | Repeat schemas and persistence in `src/lib/format/schema.ts` and `src/lib/repo/`; review and exports in `src/components/AnswersTab.tsx` and `src/lib/export/` |
| Authoring workflow and release evidence | [AGENT_PLAYBOOK.md](AGENT_PLAYBOOK.md), [questionnaire author skill](kqa-questionnaire-author/SKILL.md) | `src/lib/diagnostics/`, `src/lib/questionnaire-preview.ts` |
| Visual, accessibility, interaction and analytics design | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | `src/lib/design/`, `src/app/globals.css`, respondent components |
| Domain-specific starting packages and safeguards | [INTERVIEW_PACKAGES.md](INTERVIEW_PACKAGES.md) | `src/lib/interview-packages.ts` and the package guide |
| Worked package examples | [`examples/service-improvement.kqa.html`](examples/service-improvement.kqa.html), [`examples/personal-planning.kqa.html`](examples/personal-planning.kqa.html) and adjacent `.review.md` records | Package-based teaching examples; explicitly illustrative, not validated instruments |
| Repeatable-record format example | [`examples/repeated-assets.kqa.html`](examples/repeated-assets.kqa.html) | Technical example of bounded typed rows and `KQA.records`; not a validated instrument |
| Per-question purpose, interpretation and test plan | [QUESTION_BLUEPRINT.md](QUESTION_BLUEPRINT.md) | author review record and cognitive pretest plan |
| MCP connection, access, tools and live operations | [MCP.md](MCP.md) | `src/app/api/mcp/route.ts`, `src/lib/mcp/` |
| Static checker findings | [DIAGNOSTICS.md](DIAGNOSTICS.md) | `src/lib/diagnostics/catalog.ts`, `src/lib/diagnostics/static.ts` |
| Questionnaire authoring review evaluation | [Benchmark](evals/QUESTIONNAIRE_AUTHORING_BENCHMARK.md) | `tests/questionnaire-author-eval.test.ts`, `scripts/eval-questionnaire-author.mjs` |
| Package selection development evaluation | [Benchmark](evals/PACKAGE_SELECTION_BENCHMARK.md) | `docs/evals/package-selection-cases.json`, `tests/package-selection-eval.test.ts`, `scripts/eval-package-selection.mjs` |
| Repeatable-record pattern selection development evaluation | [Benchmark v2](evals/REPEATABLE_RECORD_SELECTION_BENCHMARK.md) | `docs/evals/repeatable-record-selection-cases.json`, `tests/repeatable-record-selection-eval.test.ts`, `scripts/eval-repeatable-record-selection.mjs` |
| Complete package-draft content review | [Benchmark](evals/PACKAGE_DRAFT_BENCHMARK.md) | `docs/evals/package-draft-cases.json`, `docs/evals/package-draft-results.schema.json`, `tests/package-draft-eval.test.ts`, `scripts/eval-package-draft.ts` |

`docs/DIAGNOSTICS.md` and `docs/kqa-manifest.schema.json` are generated from code. `docs/kqa-questionnaire-author/references/` is also generated: it contains path-preserving copies of the canonical format, playbook, design system, package guide, repeatable-record design, question blueprint, MCP guide, authoring, package-selection, repeat-pattern selection, package-draft, and trust-boundary evaluation material, starter, routing examples, and package examples with their review records. The portable skill bundle returns these references, benchmark cases, and schemas so connected agents can use the same development resources. Run `npm run docs` to regenerate them. Edit canonical source documents, examples, templates, and code definitions rather than generated files. Tests compare generated references with their canonical sources. Public benchmark corpora remain development sets, not held-out validation or respondent evidence. Other guides are maintained prose and require review against implementation when related code changes. Dated files in `docs/plans/` preserve historical decisions; use the current references above for operational behavior.

## Update and verify

When changing the questionnaire format or routing, update `FORMAT.md`, the starter/example files, the manifest schema and diagnostics as applicable, then run the checker and test suites that cover parsing, answers, exports, version changes and respondent behavior.

When changing an MCP tool, update its schema and capability mapping, `MCP.md`, and tests that assert its permissions, annotations, arguments and result. Explain whether a call is read-only, creates or publishes live state, sends email, or removes data. A tool's annotations do not replace clear descriptions or host approval boundaries.

When changing interaction behavior, align the product behavior with `FORMAT.md`, `DESIGN_SYSTEM.md`, `AGENT_PLAYBOOK.md`, and the portable author skill. State which behavior is enforced by code, which requires manual testing, and which requires respondent research; never turn a static check into a claim of usability or validity.

When changing a package, keep its stable ID and heading aligned with `src/lib/interview-packages.ts`. Add an ID rather than reusing a retired one. Bump `INTERVIEW_PACKAGE_VERSION` when package content, safeguards, or selection behavior changes materially, and record that version in the authored review. Keep package suggestions clearly distinguished from validated instruments.

Run `npm run docs`, the focused documentation and MCP tests, `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check` when the edit affects shipped docs or MCP behavior. Before deployment, confirm the documentation bundle and public assets expose the updated material, then verify the deployment health and target routes.
