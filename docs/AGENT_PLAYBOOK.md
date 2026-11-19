# AI agent playbook: write a KQA questionnaire

You are an AI agent asked to produce an HTML questionnaire for the KQA app. This page tells you exactly what to do, in order, and how to recover when the checker rejects your file. Read `FORMAT.md` first: it is the specification. This page is the procedure.

## The one-paragraph version

Output **one complete HTML file** that (1) declares every question in a JSON manifest, (2) marks each answer control with `data-kqa="<question id>"`, (3) uses no storage, network, dialogs, frames or file inputs, and (4) follows the [KQA design system](DESIGN_SYSTEM.md) and works well on a phone. The format includes eight answer types and bounded choice-based `when` routing; it does not score answers. Start from `template/starter.kqa.html`. Never rename an id or option value that has already been used. Then run the checker and fix everything it reports.

This playbook is only for writing the file. Operating a live interview (people, links, invites, answers) is the MCP server in `docs/MCP.md`, not this page. The file supports single choice, checkboxes, one-line text, and paragraphs, plus dropdown, number, scale, and date. It does not score, and it does not send email.

Agents that support portable skills can also load [`kqa-questionnaire-author/SKILL.md`](kqa-questionnaire-author/SKILL.md), or retrieve it through the `get_questionnaire_authoring_skill` MCP tool. This skill summarizes the workflow; this playbook and [`FORMAT.md`](FORMAT.md) remain authoritative for KQA behavior.

## Step 1. Gather what you need

Before writing, make sure you know:

| Need | If missing |
|---|---|
| Who answers, and what the questionnaire is for | Ask once, briefly. Do not invent a purpose |
| The questions, in order, with answer choices | If given as prose, list them back as a numbered table and proceed |
| Which questions are mandatory and when they apply | Default to optional. Mark a question `required` only when the host cannot proceed without it, and use supported `when` rules when requiredness depends on an earlier choice |
| Existing ids and option values, if this replaces an earlier file | Reuse them exactly. See "Updating an existing questionnaire" |
| Brand or tone | Default to the standard KQA look and plain Australian English |

Ask at most one round of questions. If you can proceed with a sensible default, do so and state the assumption in your reply.

Use `get_design_guidance` with `surface: "questionnaire"` when available, or read [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) and `FORMAT.md`. Follow its brief-to-review plan, use the scoped questionnaire profile from `template/starter.kqa.html` unless the host gives a different theme, and report the visual rationale plus checks performed. Treat accessibility requirements as testable constraints and visual taste as a reasoned, user-brief-grounded choice. For a live interview, preserve ids and inspect the semantic and compatibility changes before applying a version. For supported marked ordinary questions, use the source-preserving MCP block preview/apply pair; use the complete-file pair for custom questions, arbitrary page changes, or files without reliable markers.

For a domain-specific brief, use `get_interview_packages` when available or adapt the relevant starting point in [`INTERVIEW_PACKAGES.md`](INTERVIEW_PACKAGES.md). These packages are prompts and review aids, not validated instruments or substitutes for domain expertise.

When the host supplies brand CSS custom properties or token JSON, use `extract_design_profile` to inspect the values and obtain a scoped proposal. Treat mappings and contrast checks as candidates, review ambiguous/unmapped values and actual rendered states, and never treat the generated overlay as already applied. KQA parses only the supplied token text; it does not fetch linked stylesheets or modify code. Apply reviewed questionnaire changes through the complete-file preview/apply workflow.

## Step 2. Design the manifest first

Write the manifest before any markup. For each question decide:

1. **`id`**: short, lowercase, stable, meaningful. `team-size`, `primary-channel`, `q07-budget`. Never reuse an id for a different question.
2. **`type`**: use the table in FORMAT.md section 3.4. Prefer `single`, `multi`, `scale`. Use `longtext` sparingly.
3. **`label`**: the full question as a respondent reads it. Self-contained, because the host sees this label in exports without the surrounding page.
4. **`options`**: values are stable machine keys (`very-likely`), labels are human text ("Very likely"). Do not use the label as the value.
5. **`required`**, **`note`**, **`help`**, **`section`** as needed.

Group questions into sections of about 5 to 8. Give each section an `id`, `title` and a one-line `description`.

### Review the question content

Before writing markup, check that each item asks one clear thing in familiar, neutral language. Avoid leading assumptions, vague terms, double negatives, and questions that combine separate ideas. State a specific reference period when asking about time-bound behavior.

For closed questions, make the options distinct and cover the reasonable answers. Keep scale labels balanced and in a consistent direction. Add choices such as "not applicable", "not sure", "prefer not to answer", or "other" only when they fit the question. Keep option values stable across versions so existing answers remain interpretable.

When the questionnaire is new or a question could materially affect a decision, pretest it with people like the intended respondents. Ask them to explain what they think the item means and how they chose an answer. The KQA checker validates structure and supported markup; it cannot judge wording quality or replace pretesting. See the sourced question-content rubric in `get_design_guidance`.

For a new or materially changed respondent flow, plan a separate task-based usability session: ask representative participants to complete the questionnaire end to end, then record task completion, hesitation, errors, recovery, and misunderstandings. This is different from asking how a participant interprets one question. If no representative sessions occurred, report usability as untested; do not infer it from a prototype walkthrough, checker result, or screenshot.

### Mapping common survey shapes

| The source has | Do this |
|---|---|
| Yes / No | `single` with values `yes`, `no` |
| "Select all that apply" | `multi` |
| "Other (please specify)" | a `single` or `multi` with an `other` option, plus `"note": { "label": "Please specify" }` |
| 1 to 5 or 1 to 10 rating | `scale` with `min` and `max`. Add end labels in `help` |
| NPS (0 to 10) | `scale`, `min: 0`, `max: 10` |
| Matrix: rate items A, B, C | One question per row, same options. Ids like `fit-speed`, `fit-cost`, `fit-quality` |
| Ranking | KQA has no native ranking type. Separate ratings permit ties and are not a ranking. If a strict order is essential, a custom text answer can encode it, but the author must build an accessible interaction and validate its ordering; the server does not enforce a permutation. Otherwise ask a different question and explain the tradeoff. |
| Conditional follow-up | Prefer manifest `when` rules for supported choice-based routing. A required routed question is required only while eligible. Eligibility is inferred from current answers and rules, not a record of what was actually displayed. Inactive answers are retained, excluded from progress and analysis, and labelled inactive in exports. Disclose this behavior, test the route changes and restored answers, and keep reveals simple. |
| A "comments" box at the end | `longtext` with an id like `anything-else` |
| Respondent details (name, company) | `text` questions. The app already knows the respondent's name, so only ask for what you actually need |

For a complete routed example, see [`examples/routed-follow-up.kqa.html`](examples/routed-follow-up.kqa.html), also available from this KQA instance at `/api/docs/examples/routed-follow-up.kqa.html`. The earlier [`conditional-follow-up.kqa.html`](examples/conditional-follow-up.kqa.html) shows a custom scripted reveal and does not contribute native eligibility semantics.

## Step 3. Write the markup

1. Copy `template/starter.kqa.html`. Keep its `<style>` design kit unchanged, add your rules after it.
2. Replace the manifest with yours.
3. For each question, copy the matching pattern from the starter and change the id, label and values. Every card follows the same shape:

Keep `data-kqa-question-id="QUESTION_ID"` on each question block and `data-kqa-question-list="SECTION_ID"` on its containing list when you want agents to make source-preserving edits through MCP. For unsectioned questions, the list marker value is empty. These optional markers are described in [`FORMAT.md`](FORMAT.md).

Single choice (`single`). Help text is "Pick one." Nothing is pre-checked.

```html
<article class="kq-q" id="q-ID">
  <div class="kq-q-head"><span class="kq-n">N</span><h3>LABEL</h3><span class="kq-tick" data-kqa-status="ID" aria-hidden="true"></span></div>
  <p class="kq-help">Pick one.</p>
  <fieldset class="kq-options">
    <legend class="kq-sr">LABEL</legend>
    <label class="kq-opt"><input type="radio" name="ID" data-kqa="ID" value="OPTION"><span>OPTION LABEL</span></label>
  </fieldset>
</article>
```

Checkboxes (`multi`). Use "Tick all that apply" when there is no cap. If the question has a meaningful upper bound, set `maxSelections` and say "Choose up to N" in help text. A required checkbox is answered when at least one box is ticked; `maxSelections` never imposes a minimum.

```html
<article class="kq-q" id="q-ID">
  <div class="kq-q-head"><span class="kq-n">N</span><h3>LABEL</h3><span class="kq-tick" data-kqa-status="ID" aria-hidden="true"></span></div>
  <p class="kq-help">Tick all that apply.</p>
  <fieldset class="kq-options">
    <legend class="kq-sr">LABEL</legend>
    <label class="kq-opt"><input type="checkbox" data-kqa="ID" value="OPTION"><span>OPTION LABEL</span></label>
  </fieldset>
</article>
```

Free text. `text` is one line (a name, a company). `longtext` is a paragraph. Whitespace alone is an empty answer. Do not turn one into the other.

```html
<article class="kq-q" id="q-ID">
  <div class="kq-q-head"><span class="kq-n">N</span><h3>LABEL</h3><span class="kq-tick" data-kqa-status="ID" aria-hidden="true"></span></div>
  <p class="kq-help">HELP</p>
  <input type="text" data-kqa="ID" maxlength="500">
</article>
```

```html
<article class="kq-q" id="q-ID">
  <div class="kq-q-head"><span class="kq-n">N</span><h3>LABEL</h3><span class="kq-tick" data-kqa-status="ID" aria-hidden="true"></span></div>
  <p class="kq-help">HELP</p>
  <textarea data-kqa="ID" rows="4" maxlength="20000"></textarea>
</article>
```

Dropdown, number, scale, and date use the same card. Copy those patterns from `template/starter.kqa.html`.

4. Update the contents rail (`.kq-rail`) so each link points at a section `id`.
5. Do not add anything the sandbox blocks (FORMAT.md section 2).
6. Keep the content and controls semantic HTML. KQA's injected runtime is required for saving, progress, locking, and conditional routing; the page is not an offline or no-JavaScript questionnaire. Page-authored scripts should add presentation or custom-control behavior only and must use the KQA API for answers.

## Step 4. Self-check before you reply

Walk this list. It catches roughly nine problems in ten.

- [ ] Exactly one `<script type="application/json" id="kqa-manifest">`, strict JSON, `"format": "kqa/1"`.
- [ ] Count the questions in the manifest. Count the distinct `data-kqa` values in the markup. They are equal (plus any `custom` ones).
- [ ] For each option question, the `value` attributes in the markup are the **same strings** as the manifest `options[].value`, same case, same hyphens.
- [ ] Radios of one question share a `name`. Different questions never share a name.
- [ ] No `checked`, `selected`, `disabled`, `readonly` on bound controls. No pre-filled value on text, number or date inputs and no text inside a textarea (radio and checkbox controls still need their `value` attribute: that is the option value).
- [ ] Every control has a label. Every radio or checkbox group is in a `<fieldset>` with a `<legend>`.
- [ ] No `localStorage`, `sessionStorage`, `fetch`, `XMLHttpRequest`, `alert`, `confirm`, `prompt`, `<iframe>`, `<form action>`, `<input type="file">`, `location.href =`, `window.open`, `window.print`.
- [ ] External scripts and styles only from `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com`, `fonts.googleapis.com`, `fonts.gstatic.com`. Prefer none. Images may be embedded (`data:` URI or inline SVG) or use a stored workspace image URL copied from Settings/MCP (`/api/assets/<id>`); remote images and un-stored relative file paths do not load.
- [ ] No clipboard, `window.open` or print buttons: they do nothing in the frame.
- [ ] `<html lang="en-AU">`, `<title>`, viewport meta present.
- [ ] Looks right at 360 to 390 px wide and in dark mode. Any custom control repaints on `ready`, `change` and `lock`.

## Step 5. Run the checker

Run either of these from the KQA project folder (the one that contains `package.json`; the path you give is relative to where you run the command). Both use the same checker as the app:

```bash
npm run check -- path/to/questionnaire.html            # plain findings
npm run check -- path/to/questionnaire.html --agent    # the report format shown in step 6
```

or open the app's **Check a file** page, drop the file in and use **Copy for AI agent**.

The checker is static. The app also runs a **live check** in a hidden sandboxed frame. It programmatically sets standard bound controls to sample values, confirms the runtime records them, then restores the same answers and checks that the page shows them. For custom questions without bound native controls, it calls `KQA.set` and checks for a visible page mutation. This is a smoke test, not a real pointer or keyboard interaction, an end-to-end routing test, a submission/locking check, an accessibility evaluation, or a usability session. You cannot run the live check from a terminal; manually test custom behavior and any interaction paths that the probe cannot exercise.

## Step 6. Fix loop

The report you may be handed looks like this:

````
# KQA checker report for survey.html

Checker 1.0.0 · format kqa/1 · checked 2026-11-13T02:53:49.423Z
**Result: FAILED: 1 error, 1 warning, 0 notes**

## Instructions for the agent that wrote this file
(the five rules: fix every error, return the complete file, never rename existing ids ...)

## Errors (1)

### E1 · KQA303 · Option value in the page is not in the manifest
Where: line 142, column 9 · question `priority`
Problem: <input type="radio"> has value "Accuracy", which is not an option of "priority". Options: accuracy, speed, cost. Did you mean "accuracy"?
Fix: Change value="Accuracy" to value="accuracy".
Source:
```html
> 142 | <label class="kq-opt"><input type="radio" name="priority" data-kqa="priority" value="Accuracy">
```

## Warnings (1)
### W1 · KQA308 · Control has no accessible label
...

## Manifest as read
Title: Survey. 9 questions.
- `priority` (single, required, note) options: accuracy, speed, cost
...

## What these codes mean
- **KQA303 Option value in the page is not in the manifest.** The value attribute ...
````

A passing run has the same header, `**Result: PASSED: 0 errors, 0 warnings, 0 notes**` and the manifest summary, with no findings sections.

Work through it like this:

1. Read **every** finding before changing anything. Several often share one cause.
2. Fix all errors. Fix warnings too unless you have a reason not to, and say which you left and why.
3. Use the **Where** line and **Source** snippet to find the exact place. Line numbers refer to the file as uploaded.
4. Do **not** fix an error by deleting the question or control. Make the page and manifest agree.
5. Do **not** change ids or option values that existed in an earlier version just to satisfy the checker. If the old value is wrong, change the *other* side to match it.
6. Return the **complete corrected file**, not a diff or fragment. Say in one or two sentences what you changed.
7. If the next report still has findings, repeat. Stop only when the result is `PASSED` with no errors.

Every code is explained in `DIAGNOSTICS.md`.

## Updating an existing questionnaire

When the host already has answers, the file is replaced, not re-created.

* Keep every existing question `id` and option `value` exactly.
* Change labels, help text, section titles, design and layout as you like.
* Adding questions and options is safe.
* Removing a question, changing its type, or removing an option keeps old answers in the database but they stop appearing in exports for the new version. Do it only when asked, and list what you removed.
* A new `required` question is not asked of people who already submitted. Prefer optional when others have submitted.

## Converting an existing interactive HTML page

When you are given an existing HTML page (for example one generated earlier, with its own buttons and local state). Answers the old page kept in `localStorage` cannot be carried over: they live in someone's browser, so tell the host that people need to answer again.

If the page is mostly **read-only content** (a scope document, a proposal) and has few or no inputs, the questions are the places where a reader would naturally agree, choose or comment. Add them as optional questions (a `single` with `"note": true` for a decision, a `longtext` for a comment), one per item, and say in your reply which you added. Keep the total under about 60. A list that needs a comment box per row is one `longtext` question per row.

The format's design kit is the default. If the old page already has a good design with its own `:root` variables and `body` rules, keep it: put the kit's `<style>` first and the page's own CSS after it, so the page's rules win.

1. List every question the page asks. That list is your manifest.
2. Replace any state held in JavaScript variables, `localStorage` or form posts with bound controls or `KQA.set`.
3. Replace dialogs and navigation with inline UI.
4. Keep the visual design if it is good. Re-skin with the standard kit if it is not.
5. Use the manifest's `when` rules for supported routing; keep scripts for presentation only (tabs and accordions). Do not build custom visibility that conflicts with manifest eligibility. Delete copy-to-clipboard, download, print and `window.open` buttons: they do nothing in the frame.
6. Re-run the checker.
7. For anything script-driven or custom, test by hand in a browser: answer, reload, confirm the answer is still shown, then test respondent submission and confirm controls lock. The live check sets standard controls programmatically and checks answer restoration; for custom controls it calls `KQA.set` and checks for a visible mutation. It does not test human input, routing end to end, submission/locking, accessibility, or usability, and cannot be run from a terminal.

## Output contract

Your final reply contains:

1. The complete HTML file in one code block, from `<!doctype html>` to `</html>`.
2. A concise review record: question and section counts, required questions, purpose and population, key assumptions, and any decision or risk the host must review.
3. A concise evidence line with the checker result and the actual render/accessibility/testing coverage. Mark unrun checks as not tested; do not claim a pass you did not observe.

Do not repeat the HTML outside its one code block or claim unperformed checks.

## Prompt to give an agent

Paste this, then attach or paste the bundle from the app's **Format guide** page (Copy everything for an AI agent):

> Read the attached KQA format bundle completely. Then write a questionnaire file for the content below. Follow `AGENT_PLAYBOOK.md` exactly. Output the complete HTML file, a concise review record, and a concise evidence line with checks actually performed. Content: …

To get a fix, paste the checker's **Copy for AI agent** output with:

> This is the KQA checker's report on the file you wrote. Fix every error and warning and return the complete corrected file.
