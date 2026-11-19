# KQA questionnaire format (kqa/1)

This is the complete specification for the HTML file you upload to KQA. If you are an AI agent asked to build a questionnaire for KQA, read this page end to end, then read `AGENT_PLAYBOOK.md`. Start from `template/starter.kqa.html`, which passes the checker as it stands.

KQA gives every respondent a private link, renders your HTML inside a sandboxed frame with the KQA respondent shell and runtime, saves each answer to MongoDB as they go, and lets the host review and export everything. Your file does not talk to the database, and it does not send email. It declares its questions, marks which controls hold which answer, and the KQA runtime does the rest.

Autosave requires a connection. While offline, new edits remain only in the open page and retry when the connection returns; they are not saved on the device. The status says when changes are waiting to sync. Keep the page open until it reports **Saved**; the best-effort page-exit request is not a confirmed save.

If the host publishes a new questionnaire while your page is open, KQA rejects writes from the old version and locks that page. Confirmed answers remain saved. KQA keeps rejected edits in memory on the open page and lets you review or copy them before reloading; it never transfers them automatically because the questions or their meaning may have changed. Reload to continue with the latest version. Transient page-exit save failures stay marked as not saved and are retried while the page remains open; other failures remain marked so you can review them.

The everyday questions are a single choice (`single`), checkboxes (`multi`), a one-line free-text field (`text`, 500 characters unless you set `maxLength`), and a paragraph (`longtext`, 20,000 characters unless you set `maxLength`). Dropdowns (`select`), numbers, scales, dates, full-order ranking (`rank`), and bounded repeatable record groups (`repeat`) are supported. Section 3.4 is the full list. Repeated records are structured child rows belonging to one respondent and one question; they are not additional respondents or scalar answer values. KQA does not score answers or rank people. A required checkbox is answered when at least one box is ticked; a required ranking is answered when every option is present in the saved order. A required repeat group needs at least one complete row; `minRows` can require more. Text that is only spaces is empty.

## 1. How it works

```
 your HTML file                       KQA app                           MongoDB
 ┌────────────────────┐   postMessage  ┌──────────────┐   HTTPS/JSON   ┌──────────┐
 │ manifest (JSON)    │ ─────────────▶ │ respondent   │ ─────────────▶ │ answers  │
 │ controls data-kqa  │ ◀───────────── │ shell + bar  │ ◀───────────── │          │
 │ KQA runtime (auto) │   saved answers└──────────────┘                └──────────┘
 └────────────────────┘
```

1. The host uploads your file. KQA runs the **checker**, which reads the manifest and matches every question to its controls. Errors block the upload and come back as a report you can act on.
2. For each respondent, KQA serves your file inside a sandboxed frame and **injects the KQA runtime** as the first script in `<head>`. You never write or load that script.
3. The runtime reads the controls you marked with `data-kqa`, sends every change to the app, and fills the controls back in when the person returns. The app validates each value against your manifest and saves it.
4. When the person presses **Review answers** in the app's top bar, KQA opens a **Check your answers** review. The respondent can see current eligible answers, notes, and any answer that needs attention, then return to edit a question. They can open the review even when required answers are still empty. Submitting locks answers; the host can reopen them. Questions inactive under current routing rules are omitted from the main review list. A collapsed **Previously answered hidden questions** section lets respondents inspect and clear retained answer values or optional notes without changing the answer that controls routing. Clearing a value leaves its note intact; clearing a note leaves its value intact. The section explains that remaining answers may reappear if a question becomes eligible again.

Your file is therefore three things: a manifest, markup with bindings, and your own look. By default respondents see the whole eligible questionnaire on one page. You can opt into guided steps with `"presentation": "guided"` (one section per step) or `"presentation": "guided-question"` (one eligible root question per step). The markup requirements are below.

## 2. File rules

| Rule | Value |
|---|---|
| Type | One self-contained `.html` file, UTF-8 |
| Size | Up to 3 MB. Do not embed large base64 images or fonts |
| Structure | A full document: `<!doctype html>`, `<html lang="en-AU">`, `<head>`, `<body>` |
| Viewport | `<meta name="viewport" content="width=device-width, initial-scale=1">` |
| Language | `lang` on `<html>` must match the questionnaire language; use `en-AU` for Australian English |
| Title | A `<title>` element |
| Layout | Must work from 360 px wide up with no sideways scrolling. Respondents use phones. Test at 390 px |
| Colour | Light and dark via `prefers-color-scheme` |
| Frames and navigation | No `<iframe>`, `<object>`, `<embed>`, `<base>`, or meta refresh. KQA-supported `https:`, `mailto:`, and `tel:` links open through the host app; scripted or top-level navigation is not supported. |

The questionnaire is a separate HTML document inside KQA's respondent experience. Set its root `lang` to the questionnaire's actual language using a valid BCP 47 tag (for example, `fr-CA`, `vi`, or `en-AU`); this helps assistive technology identify and pronounce its content. The built-in respondent shell currently supports Australian English (`en-AU`), Vietnamese (`vi`), Spanish (`es`), and Arabic (`ar`). On first visit it uses the first supported language in the browser's `Accept-Language` preferences, falling back to `en-AU`; a respondent can change the visible language selector, and that choice is saved in a first-party preference cookie for one year. The shell's language and direction are independent from the questionnaire document's own `lang` and `dir`: selecting Arabic makes shell controls right-to-left, but does not translate or change the direction of questionnaire content. Set the questionnaire document's own language and direction accurately and mark passages in other languages with `lang` on the smallest appropriate element.

Treat language access as an end-to-end journey: include the invitation, consent/privacy notice, help and support, navigation, save and error states, answer review, submit, and completion. The shell translations are an initial product localization; Vietnamese, Spanish, and Arabic wording has not yet had native-speaker or in-context respondent review. Do not claim translation accuracy, cultural equivalence, full localization of host-authored material, accessibility, or field readiness from the language selector or translated shell alone. Before fielding, arrange qualified linguistic review and test realistic tasks and recovery with intended-language respondents; verify an in-language journey or host-approved accessible alternative. Block fielding when respondents cannot reliably understand or operate essential steps. For right-to-left questionnaire content, use semantic `dir="rtl"` on `<html>` and test reading order, controls, entered text, and layout. See the [HTML language attribute](https://html.spec.whatwg.org/multipage/dom.html#the-lang-and-xml:lang-attributes), [WCAG language-of-page guidance](https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html), [language-of-parts guidance](https://www.w3.org/WAI/WCAG22/Understanding/language-of-parts.html), and [W3C bidirectional-text practices](https://www.w3.org/International/docs/bp-html-bidi/). The checker reports KQA505 for non-English questionnaire `lang` values; it is a review reminder, not a block or translation-quality test.

### Question and section markers

These markers let KQA identify each complete question block and its containing list. In the default `all` presentation they are optional, except when you want source-preserving MCP edits. In either guided presentation they are required so KQA can hide and reveal a complete question without hiding controls that belong to another question:

* Put `data-kqa-question-list="SECTION_ID"` on the element that directly contains a section's question blocks. Use an empty value (`data-kqa-question-list=""`) for questions without a section.
* Put `data-kqa-question-id="QUESTION_ID"` on the single root element for each question block. That element must be a direct child of its matching marked list.

In either guided presentation, every manifest question must have exactly one `data-kqa-question-id` wrapper, that wrapper must be a direct child of a `data-kqa-question-list` matching its manifest section, and every non-empty list marker must name a declared section. `guided` requires at least one section and assigns every question to one. `guided-question` does not require sections; for an unsectioned question, use `data-kqa-question-list=""`. The checker reports incomplete markup as KQA321. `preview_questionnaire_block_patch` also uses these markers for targeted edits and supports ordinary, non-custom questions only. It accepts one root element per added or replacement block and rejects scripts and inline event-handler attributes in those fragments. It can move a marked question between sections and place an added or moved question before or after an unchanged question in the same section. It does not infer custom JavaScript behavior. If markers are absent, duplicated, or out of sync with the manifest, use the complete-file preview and apply workflow in `MCP.md`.

### What the sandbox allows

The page runs in an iframe with `sandbox="allow-scripts allow-forms"` and a strict Content-Security-Policy. In practice:

* **Scripts** run, from inline `<script>` or from `cdnjs.cloudflare.com`, `cdn.jsdelivr.net` or `unpkg.com` only.
* **Styles** may be inline, or `fonts.googleapis.com` / `cdnjs.cloudflare.com` stylesheets. **Fonts** load from `fonts.gstatic.com`.
* **Images** can be embedded as `data:` URIs or inline `<svg>`, or saved in the workspace image library. Upload images in Settings or with the MCP image tools, then use the returned `/api/assets/<id>` URL in `<img src>` or CSS `url()`. Remote image hosts do not load (KQA417); relative files such as `./logo.png` are not included with the questionnaire (KQA418). Inline SVG is a good choice for small logos and icons.
* **No network calls.** `fetch`, `XMLHttpRequest`, WebSocket and form posts are blocked (`connect-src 'none'`, `form-action 'none'`). All data goes through `KQA`.
* **No browser storage.** `localStorage`, `sessionStorage`, cookies and IndexedDB are unavailable because the frame has an opaque origin. Do not use them. Use `KQA.set` / `KQA.get`.
* **No modal dialogs.** `alert`, `confirm`, `prompt` do not work in a sandboxed frame. Build inline UI.
* **No file inputs, downloads, printing, clipboard access or `window.open`.** Copy-to-clipboard buttons do not work, so leave them out.
* **Links:** a link to `https://`, `mailto:` or `tel:` opens in a new window through the app (with no connection back to the page), so ordinary `<a href="https://…">` links work. Links to other files do not. In `presentation: "all"`, `#section` links scroll within the page; in guided mode, links cannot reveal a different step, so use the shell's Back/Continue controls instead. Do not navigate the page with script (`location`, `history`).

The checker reports each of these before upload (codes KQA4xx).

## 3. The manifest

Exactly one `<script type="application/json" id="kqa-manifest">` element holding a JSON object. Put it in `<head>` or at the top of `<body>`. It is data, so it must be strict JSON: double quotes, no comments, no trailing commas.

```json
{
  "format": "kqa/1",
  "title": "Starter questionnaire",
  "description": "One sentence about what this is.",
  "sections": [
    { "id": "choices", "title": "Choices", "description": "Optional text under the heading." }
  ],
  "questions": [
    {
      "id": "priority",
      "type": "single",
      "section": "choices",
      "required": true,
      "label": "Which area should we start with?",
      "help": "Pick one.",
      "options": [
        { "value": "accuracy", "label": "Accuracy of the ratings" },
        { "value": "speed", "label": "Speed of each run" }
      ],
      "note": true
    },
    {
      "id": "improvements",
      "type": "multi",
      "section": "choices",
      "required": false,
      "label": "Which improvements would help most?",
      "help": "Choose 2 to 3; leave blank to skip.",
      "minSelections": 2,
      "maxSelections": 3,
      "options": [
        { "value": "accuracy", "label": "More accurate ratings" },
        { "value": "speed", "label": "Faster runs" },
        { "value": "clarity", "label": "Clearer reports" }
      ]
    }
  ]
}
```

A machine-readable JSON Schema is in `kqa-manifest.schema.json`. It is generated from the same definition the checker uses, so the two cannot disagree.

### 3.1 Top-level fields

| Field | Required | Rule |
|---|---|---|
| `format` | yes | Exactly `"kqa/1"` |
| `title` | yes | 1 to 120 characters. Shown in the app's top bar and exports |
| `description` | no | Up to 500 characters |
| `presentation` | no | `"all"` (default), `"guided"` (one eligible section per step), or `"guided-question"` (one eligible root question per step); guided presentations require question/list markers |
| `sections` | no | Up to 50. Groups and orders questions in exports and the answers view |
| `questionOrderGroups` | no | Off by default. Explicit groups of adjacent, independent root questions whose respondent-facing order may vary; supported only with `presentation: "all"` |
| `questions` | yes | 1 to 500 questions, in the order they should appear in exports |

`questionOrderGroups` is a list of `{ "id", "questionIds" }` objects. Each group needs a stable id and at least two question ids in their authored manifest order. Members must form one contiguous run, share the same section (or all be unsectioned), use standard non-custom questions, and have no `when` condition. No question may use a group member as a routing source. The checker reports unsafe configurations as KQA224.

Question-order groups work only with `presentation: "all"`. Neither guided mode can honor a respondent-specific reordering: `guided` follows the order sections first appear in the manifest questions, and `guided-question` follows manifest question order. Keep the authored order fixed in either guided flow.

Each group member must have one whole-question `data-kqa-question-id` wrapper, including any instructions or supporting content for that item. The wrappers must be adjacent direct children of one `data-kqa-question-list` matching the group section; for unsectioned groups, use `data-kqa-question-list=""`. Keep explanatory content inside its question wrapper rather than between members. The checker reports incomplete or mismatched markup as KQA322. The runtime moves complete wrappers in the DOM, so visual, reading, and keyboard sequence follow the same assigned order. If runtime markup does not match, it keeps the authored order.

KQA assigns a repeatable permutation per participant, survey version, and group, then stores that complete assignment independently from answers. Reloads keep the stored order; a later survey version gets its own assignment. The manifest order stays canonical for routing, validation, and exports. Hosts can review the assigned group order and exports retain the exact question ids, survey version, algorithm version, and assignment time, including groups with no answers. “Assigned” records the order returned to the respondent app; it does not confirm that every question was viewed.

Use question-order variation only when the research question or usability goal warrants it. Question context can change answers, and rotation distributes rather than removes order effects. Pretest wording and navigation with intended respondents; for an experiment, define the comparison and outcome criteria in advance and analyze assignments by survey version. Do not shuffle screeners, routed questions, consent or instructions, sensitive sequences, or content whose order carries meaning. See the [AAPOR Best Practices](https://aapor.org/standards-and-ethics/best-practices/), [Census Standard A2](https://www.census.gov/about/policies/quality/standards/standarda2.html), [Census Appendix A2](https://www.census.gov/about/policies/quality/standards/appendixa2.html), and [WCAG 2.2 Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html).

### 3.2 Section fields

| Field | Required | Rule |
|---|---|---|
| `id` | yes | Lowercase letters, digits, `-` and `_`. Starts with a letter or digit. Up to 64 characters (`^[a-z0-9][a-z0-9_-]{0,63}$`) |
| `title` | yes | Up to 300 characters |
| `description` | no | Up to 1000 characters |

### 3.3 Question fields

| Field | Required | Applies to | Rule |
|---|---|---|---|
| `id` | yes | all | Same pattern as section ids. **Unique across the manifest. Never rename once people have answered** |
| `type` | yes | all | `single`, `multi`, `select`, `text`, `longtext`, `number`, `scale`, `date`, `rank`, `repeat` |
| `label` | yes | all | The question text. Up to 300 characters. Used in the host's answers view and every export |
| `help` | no | all | Up to 1000 characters |
| `section` | no | all | Must be the `id` of a declared section |
| `required` | no | all | `true` blocks Submit until answered. Default `false` |
| `options` | yes for `single`, `multi`, `select`, `rank` | those four | 2 to 50 items of `{ "value", "label" }`; `rank` requires 2 to 8. Not allowed on other types |
| `maxSelections` | no | `multi` | Maximum distinct checked options, from 1 through the number of options. Omit for no maximum. It does not set a minimum or change requiredness |
| `minSelections` | no | `multi` | Minimum distinct checked options for a non-empty answer, from 1 through the number of options. Omit for no minimum. Must not exceed `maxSelections` when both are set. An optional empty answer remains a valid skip |
| `exclusiveOptions` | no | `multi` | Non-empty list of declared option values that must be selected alone (for example, `none`, `not-sure`, or `prefer-not`). These options are not added automatically |
| `randomizeOptions` | no | `single`, `multi`, `select` | `true` opts into respondent-specific rotation of nominal response options. Defaults to `false`. Do not use for rank, scales, or categories with an inherent order |
| `fixedOptionValues` | no | `single`, `multi`, `select` when `randomizeOptions` is `true` | List of declared option values whose positions remain fixed in their authored slots while eligible options are rotated through the remaining slots. Values must be unique and declared; this does not add options automatically |
| Full-order contract | — | `rank` | A non-empty answer contains every declared option exactly once; partial rankings are invalid. The stored value is an array of option values in respondent-chosen order. An optional rank may remain unanswered. If a later questionnaire version changes the option set, a retained old order must be confirmed against every current option before submission. |
| `note` | no | all | `true`, or `{ "label", "placeholder", "maxLength" }`. Enables an optional free-text note stored beside the answer. Up to 5000 characters |
| `min`, `max` | no | `number`, `scale` | `scale` defaults to 1 to 5 and uses safely representable whole-number bounds, with `min` below `max` and a span of at most 20 steps |
| `step` | no | `number`, `scale` | Positive number |
| `maxLength` | no | `text`, `longtext` | Default 500 for `text`, 20000 for `longtext` |
| `fields` | yes for `repeat` | `repeat` | 1 to 12 typed fields (`single`, `select`, `text`, `longtext`, `number`, `scale`, `date`); each has a stable `id`, `label`, optional `help` and `required`, plus type-appropriate options or bounds |
| `maxRows` | yes for `repeat` | `repeat` | Maximum respondent-created rows, 1 to 20 |
| `minRows` | no for `repeat` | `repeat` | Minimum number of complete rows required at submission, 0 to `maxRows`; default 0. A required repeat question always requires at least one complete row |
| `itemLabel` | no for `repeat` | `repeat` | Singular noun used in generated row labels and add/remove controls; defaults to “item” |
| `custom` | no | all | `true` when the answer is set from script with `KQA.set()` and has no `data-kqa` control |
| `when` | no | all | Bounded visibility rule. Use `all` and/or `any`, each with 1 to 20 conditions. Conditions can test whether any earlier answer type is `answered`/`notAnswered`, compare earlier choices (`equals`/`notEquals`, `contains`/`notContains`), or compare earlier `number`, `scale`, or `date` answers using `lt`, `lte`, `gt`, `gte`, `eq`, or `ne` |

Option `value` rules: starts with a letter or digit, then letters, digits, `.`, `_`, `:` or `-`, up to 64 characters (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`). Values are what is stored. Labels are what people see in the host's views and exports. Keep values short, lowercase and stable.

#### Nominal option rotation

Option rotation is off unless `randomizeOptions: true` is explicitly set. Use it only when answer choices are nominal and have no meaningful sequence, and only for `single`, `multi`, or `select`. Never rotate `rank`, `scale`, or ordered categories such as frequency, agreement, age bands, or low-to-high ranges. If a choice must stay in place (for example, “Other”, “None of these”, or “Prefer not to answer”), name its stable `value` in `fixedOptionValues`; its authored slot is preserved while other choices are rotated. Do not infer fixed choices from their labels. Keep the manifest order as the canonical authored order.

Rotation distributes position effects; it does not eliminate them or make a convenience sample representative. Pretest the wording and presentation with people like the intended respondents, and retain the presented option order as analysis provenance. Interpret results alongside questionnaire version and order provenance, especially when comparing groups or versions. Randomization should not be used to imply that ordering effects have been controlled completely. See Pew Research Center's [survey question and response-option guidance](https://www.pewresearch.org/writing-survey-questions/) and the Australian Bureau of Statistics' [question structure guidance](https://www.abs.gov.au/statistics/standards/abs-forms-design-standards/2023/general-forms-design-principles-question-structure).

Routing conditions are intentionally declarative: they cannot contain scripts, nested expressions, or comparisons to free text. `answered` and `notAnswered` check whether an earlier question has a non-empty value; whitespace-only text and an empty checkbox array count as unanswered, and an optional note alone does not count. All condition sources must appear earlier in the manifest and must themselves be eligible. Choice comparisons use the source's declared option values. Typed comparisons use finite JSON numbers for `number`, whole-number operands within the declared scale bounds for `scale`, and real `YYYY-MM-DD` calendar dates for `date`. Number and scale comparisons are numeric; dates compare as calendar values without timezone conversion. The operators `lt`/`lte`/`gt`/`gte` mean less than, less than or equal, greater than, and greater than or equal; `eq`/`ne` mean equal/not equal. A typed comparison is false when its source is missing, blank, malformed, outside its declared range, or ineligible, including `ne`; zero is a valid number. Do not use negative comparisons to treat missing data as a response. When both lists are present, every `all` condition and at least one `any` condition must match; when only one list is present, that list determines visibility. When a parent answer changes, KQA recomputes downstream eligibility in manifest order. The respondent runtime hides, makes inert, and disables controls in an ineligible question block; therefore wrap each routed question in one whole-question element with `data-kqa-question-id="QUESTION_ID"`. Do not put multiple questions in the same marked block. Hidden questions remain in the interview's data model; their answers are retained if a condition later changes. Requiredness and progress apply only while a question is eligible. The server rejects new non-empty values or notes for currently inactive questions, while allowing a respondent to clear a retained value.

For example, after an optional `details` question, a follow-up can use `{ "when": { "all": [{ "question": "details", "operator": "answered" }] } }` to appear only when the person entered a value. Use `notAnswered` to target an unanswered earlier item; use `equals` with a declared option value for `single`/`select`, `contains` for a `multi` value, and `{ "question": "age", "operator": "gte", "value": 18 }` for a numeric threshold. A date comparison uses a valid ISO calendar value, such as `{ "question": "start-date", "operator": "lt", "value": "2026-01-01" }`. Keep each condition list to 20 items or fewer and test below/equal/above boundaries, missing values, and edits that show or hide the follow-up.

See the complete [`routed-follow-up.kqa.html`](examples/routed-follow-up.kqa.html) example for an eligible required follow-up, respondent disclosure, and stable saved-answer behavior.

When the labels are long sentences, use a short meaningful slug (`agree-with-suggestion`, `prefer-phased-rollout`) or a positional key (`o1`, `o2`, `o3`) that you never reorder or reuse. Never use the sentence itself as the value.

The order of questions on the page does not have to match the manifest. The manifest order is the order in exports and the answers view.

Unknown fields are ignored with a warning (KQA216), so a typo in a field name silently does nothing. Check the spelling.

**Label and help.** `label` is the question itself and must make sense on its own, because the host reads it in exports without the page around it. `help` is the instruction to the respondent ("Pick one", "Tick all that apply"). Read-only background text can stay in the page only; it does not need to be repeated in `help`.

For a bounded checkbox group, set `minSelections` and/or `maxSelections` only when those bounds reflect the decision, and state the permitted range in `help` (for example, "Choose 2 to 3; leave blank to skip"). A minimum applies to non-empty answers: an optional blank remains a valid skip, while a required blank still needs an answer. Partial non-empty selections autosave so respondents can make progress, but an answer below the minimum must be corrected before guided Continue or final submission. The runtime adds visible guidance and does not silently add or remove choices. Existing saved answers that fall below a newly raised minimum or above a newly lowered maximum stay visible; respondents can edit them, and submission remains blocked until the current eligible answer satisfies the new bounds. `minSelections` cannot exceed `maxSelections`.

For example, the manifest question above allows a respondent to choose two or three improvements, or leave the optional question blank. If they select one, that partial value is saved, but KQA asks them to add another choice before they continue or submit.

For a checkbox option that cannot logically combine with any other answer, declare its value in `exclusiveOptions` (for example, `"exclusiveOptions": ["none"]`). The native controls clear other checked choices when an exclusive option is selected, and clear exclusive choices when a substantive option is selected; the change is announced to assistive technology. Custom controls must implement the same rule, explain rejected values, and handle `KQA.set()` returning `false`. If a revised live questionnaire newly makes an option exclusive, KQA preserves existing mixed answers and warns the host; affected respondents must resolve the conflict before submission. Analytics excludes unresolved conflicting answers from valid distributions. Do not use exclusivity to force an answer: keep the option optional where appropriate and include a clear way to decline or say “not sure” when the task calls for it. This follows the [ABS guidance on question types](https://www.abs.gov.au/statistics/standards/abs-forms-design-standards/2023/general-forms-design-principles-question-type) and [W3C guidance for status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).

**Text fields.** `text` is a free line of text. Using `type="email"`, `tel` or `url` on the input only changes the keyboard on a phone; nothing validates the format, so the stored value is whatever was typed.

### 3.4 Choosing a type

| You want | Use | Control |
|---|---|---|
| Pick exactly one of a few options | `single` | `<input type="radio">` group |
| Pick any number of options | `multi` | `<input type="checkbox">` group |
| Pick one from a long list | `select` | one `<select>` |
| A short line of text | `text` | `<input type="text">` (or `email`, `tel`, `url`) |
| A paragraph | `longtext` | `<textarea>` |
| A quantity | `number` | `<input type="number">` |
| A rating, such as 1 to 5 | `scale` | numbered radios, or `<input type="range">` |
| A calendar date | `date` | `<input type="date">` |
| Order every option from highest to lowest priority | `rank` | an ordered list (`<ol>`) with one item per option |
| Collect a bounded number of structured instances for one respondent | `repeat` | one semantic `<template>` containing a fieldset row prototype |
| Anything else (custom drag and drop, matrix, sliders with custom UI) | any type + `custom: true` | your own markup that calls `KQA.set` |

#### Bounded repeatable records (`repeat`)

Use a repeat group when one respondent needs to report a small, finite number of similar entities or events, such as several assets, previous roles, or work locations. Prefer a checkbox when respondents choose from a known unordered list, fixed questions when the number of instances is known, and a short text field only when structured fields are unnecessary. Do not use a repeat group as a live operational log, incident reporting channel, anonymous channel, or a substitute for a safety process. State what counts as one row, the reference period, whether to include every instance or only selected ones, and what to do when the maximum is reached. Keep the cap as low as the decision allows.

Each repeat question declares `fields`, `maxRows`, and optionally `minRows` and `itemLabel`. Fields use stable unique ids within that group. `single` fields use radio options; `select` fields use a dropdown; text, paragraph, number, scale, and date fields follow their scalar validation rules. A row is complete when all its `required` fields are valid and non-empty. Optional fields may be blank. The group is answered when it has at least one active row. Requiredness and `minRows` are enforced at submission for eligible groups; required fields are validated on every active row. Rows are saved separately from `answers` and do not multiply respondent-level progress or denominators. Hidden groups retain their data and do not block submission while ineligible.

Declare exactly one semantic `<template data-kqa-repeat-template="QUESTION_ID">` for each repeat question. Inside it, put one `<fieldset>` with a `<legend>` and native labeled controls marked `data-kqa-repeat-field="FIELD_ID"`; include each declared choice option exactly once. The runtime clones the template, assigns respondent-specific stable row identifiers and unique control names, and provides accessible add/remove buttons. Do not pre-clone rows, bind a repeat question with `data-kqa`, assign generated question ids, or implement your own persistence. Generated row controls are localized with the KQA shell language; author-provided labels and question content remain in the questionnaire's language. Test add, remove, validation, returning to edit, small screens, keyboard use, and screen-reader announcements. Row removal is a respondent data change and removes that row from the active answer set.

```json
{
  "id": "assets",
  "type": "repeat",
  "label": "Which assets did you inspect during this shift?",
  "help": "Add one row per inspected asset. Include all assets; the maximum is 10.",
  "required": true,
  "itemLabel": "asset",
  "maxRows": 10,
  "minRows": 1,
  "fields": [
    { "id": "name", "type": "text", "label": "Asset identifier", "required": true },
    { "id": "condition", "type": "select", "label": "Observed condition", "required": true,
      "options": [{ "value": "ok", "label": "No issue observed" }, { "value": "attention", "label": "Needs attention" }] },
    { "id": "checked-on", "type": "date", "label": "Inspection date" }
  ]
}
```

Repeat records contain potentially sensitive person-linked data. Use data minimisation, disclose collection and retention accurately, apply the host's access and deletion policies, and pretest the task with intended respondents. Review row-level exports as personal data. KQA keeps repeated rows out of ordinary scalar summaries and cross-tabs by default. See [repeat-record design and research](kqa-questionnaire-author/references/REPEATABLE_RECORDS_DESIGN.md) for selection, burden, data, and validation guidance.

See the complete [`repeated-assets.kqa.html`](examples/repeated-assets.kqa.html) example for the semantic template and native field binding pattern. It is a technical example, not a validated industrial inspection instrument or a safety reporting process.

A matrix such as "rate each of these five items" is **five questions**, one per row, usually `scale` or `single` with the same options. Use `rank` only when the task requires relative ordering of the options and ties are intentionally not allowed. State the dimension and direction in the question (for example, "order all options from highest to lowest priority"), explain that every option must be placed once, and keep the list short: forced rankings take more effort and can make near-equal options seem meaningfully different. Test comprehension and completion with intended respondents, including on the devices they are likely to use. Use separate ratings when options can be equally important or deserve independent judgments; use `multi` when choices are unordered. The respondent may confirm the displayed starting order or use the accessible move controls. Ranking records relative order, not the size of differences between positions; do not interpret rank positions as independent ratings or a score. Ranking options is not a way to rank people, candidates, employees, patients, or other individuals. See the [Australian Bureau of Statistics' question-type guidance](https://www.abs.gov.au/statistics/standards/abs-forms-design-standards/2023/general-forms-design-principles-question-type), Smyth, Olson and Burke's [experimental comparison of ranking formats](https://digitalcommons.unl.edu/sociologyfacpub/542/), and Vriens et al.'s research on [order effects and ipsative ranking data](https://journals.sagepub.com/doi/10.1177/0049124115588997). Findings depend on method and population; these sources support pretesting, not a universal ranking format.

## 4. Binding controls

Bind a control to a question by giving it `data-kqa="<question id>"`. The runtime listens for `input` and `change` events on bound controls and handles its own Move up/Move down clicks for native `rank` lists.

| Type | Markup | Stored value |
|---|---|---|
| `single` | Several `<input type="radio" data-kqa="ID" name="ID" value="OPTION">`, one per option. Same `name`. | the chosen option `value` (string) |
| `multi` | Several `<input type="checkbox" data-kqa="ID" value="OPTION">` | array of chosen option values, in manifest order; `minSelections` and `maxSelections` validate non-empty answers |
| `select` | `<select data-kqa="ID">` with `<option value="OPTION">`. Keep a first `<option value="">` as the placeholder | the chosen option value |
| `text` | `<input type="text" data-kqa="ID">` | string, trimmed-empty clears |
| `longtext` | `<textarea data-kqa="ID">` | string |
| `number` | `<input type="number" data-kqa="ID" min max step>` | finite number within `min`/`max` |
| `scale` | `<input type="radio" data-kqa="ID" name="ID" value="1">` … one radio per integer, or `<input type="range" data-kqa="ID" min max step>` | integer within the scale |
| `date` | `<input type="date" data-kqa="ID">` | real calendar date as `YYYY-MM-DD`, years 0001–9999 |
| `rank` | `<ol data-kqa="ID"><li data-value="OPTION">OPTION LABEL</li>…</ol>` | array containing every option value exactly once, in the respondent-chosen order |

Rules the checker enforces:

* **Every manifest question needs a control**, unless it is `custom: true` (KQA300).
* **Every `data-kqa` must name a manifest question** (KQA301). A typo here means the answer is never saved.
* **The control type must match the question type** (KQA302). A `single` question cannot be a text box. For `rank`, bind one ordered list whose list items map one-to-one to the manifest options.
* **Every option value in the page must exist in the manifest, and every manifest option must have a control** (KQA303, KQA304). Compare them character for character, including case.
* For `rank`, the bound `<ol>` contains one `<li data-value="OPTION">` for each manifest option. Values are unique, labels correspond to those values, and the initial list order is the starting order. The runtime decorates the list with accessible Move up/Move down buttons and a **Use this order** confirmation, so a respondent can accept the starting order without moving anything. Moving an item saves the full ordered array; an untouched optional rank stays unanswered. Do not add drag-only behavior or authored rank buttons.
* Radios of one question share one `name`, and radios of different questions never share a name (KQA307, KQA319).
* Radio and checkbox controls that carry `data-kqa` need a `value` attribute (KQA312). Unbound inputs (a filter toggle, a presentation-only slider) are ignored by the checker and may be used freely, but they save nothing.
* `data-kqa` goes on `input`, `select` or `textarea`, not on a `div` or `label` (KQA309), except that a native `rank` question binds its `<ol>` as specified above.
* Bound controls must not be `disabled` or `readonly` in the markup (KQA310). KQA locks them itself after Submit.
* Do not pre-select anything in the markup (`checked`, `selected`, `value="…"`). Defaults would never be saved (KQA320).
* Give every control an accessible name: a wrapping `<label>`, `<label for>`, `aria-label` or `aria-labelledby` (KQA308). Wrap radio and checkbox groups in `<fieldset>` with a `<legend>` (can be visually hidden), or give the container `role="radiogroup"` (or `group`) with `aria-labelledby` (KQA318).
* Keep `min`, `max`, `step` and `maxlength` on the control equal to the manifest (KQA314). Set `min` and `max` explicitly on `<input type="range">`: the browser defaults of 0 and 100 would not match a 1 to 5 scale.

### 4.1 Notes

If a question has `"note": true` (or an object), add a note field anywhere in the page:

```html
<textarea data-kqa-note="priority" rows="2" placeholder="Optional" aria-label="Note for: Which area should we start with?"></textarea>
```

The checker requires that a `data-kqa-note` points at a question that enables notes (KQA305, KQA306). Notes are stored as `note` beside `value`, and exported as their own column. If the question's `note` object sets `maxLength`, set the same `maxlength` on the note textarea; without it the limit is 5000 characters. One note field per question: for a list with one comment box per row, make each row its own question (a `longtext`, or a `single` with `"note": true`).

For native `text`, `longtext`, and note controls, KQA shows an inline character count when the respondent reaches 80% of the limit. The count is linked to the field's description while visible, and a polite screen-reader status announces only when the field approaches, reaches, or exceeds the limit—not on every keystroke. The count follows the same JavaScript string-length units as HTML `maxlength` and server validation (UTF-16 code units); some symbols such as emoji can use more than one unit. At runtime, KQA removes the native browser `maxlength` clamp after static validation so a long paste is not silently truncated. Text above the configured limit stays visible in the field, is not sent to autosave, remains an in-memory draft through answer refreshes, and blocks guided progress, answer review, and submission until shortened. KQA warns before leaving while such an unsaved draft is present; it does not persist an over-limit draft across reloads or browser closure. At the limit, KQA uses the questionnaire's `--danger` color token when available, plus bold text and an explicit limit message; its normal count inherits the questionnaire text color. Saved answers that exceed a later, lower limit are displayed without truncation and marked over limit. A custom `KQA.set` control owns its own length feedback.

### 4.2 Status ticks

Optionally mark an element that reflects whether a question is answered:

```html
<span class="kq-tick" data-kqa-status="priority" aria-hidden="true"></span>
```

The runtime sets `data-state="answered"` or `data-state="empty"`. Style it with `[data-state="answered"]`.

### 4.3 Custom questions

When the standard controls are not enough, set `"custom": true`, build your own UI, and talk to the runtime. Three rules make a custom control work: **write** with `KQA.set`, **read** with `KQA.get`, and **repaint** whenever `ready`, `change` or `lock` fires. The repaint rule matters most. It is how a person who returns to their link sees their earlier answer. `KQA.set` and `KQA.clear` return `false` when a value is rejected; listen for `KQA.on("validation", ...)` to show or clear field-level feedback. A custom `multi` control must enforce `maxSelections` and ensure every `exclusiveOptions` choice stands alone. Allow blank optional values and partial answers to autosave; explain that an under-minimum non-empty answer needs more choices before Continue or submission. Explain a rejected choice to the respondent; `KQA.set` remains strict and does not silently discard selections. Wrap each custom question in one whole-question element with `data-kqa-question-id="QUESTION_ID"`; this lets routing hide the full question and the respondent shell's **Questions** menu focus its first visible enabled control. If the block has no focusable control, the runtime temporarily makes the block itself programmatically focusable for the jump.

```js
// A five-star control for a custom question with id "stars" (type scale, min 1, max 5)
const host = document.querySelector('[data-kqa-question-id="stars"]');
const buttons = [1, 2, 3, 4, 5].map((n) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = String(n);
  b.addEventListener("click", () => KQA.set("stars", n));   // write
  host.appendChild(b);
  return b;
});
function paint() {                                          // read and show
  const current = KQA.get("stars");
  buttons.forEach((b, i) => {
    b.setAttribute("aria-pressed", String(current === i + 1));
    b.disabled = KQA.locked;                                 // locked after Submit
  });
}
KQA.on("ready", paint);   // saved answers have arrived
KQA.on("change", paint);  // any change, including one made by KQA.set below or by the app
KQA.on("lock", paint);    // submitted or reopened
```

```html
<section data-kqa-question-id="stars" aria-labelledby="stars-label">
  <h2 id="stars-label">How confident are you?</h2>
</section>
```

* `KQA.set` fires `change` too, so a control repaints itself without calling `paint()` by hand.
* The value passed to `KQA.set` must satisfy the question's type exactly as in the table above (a `scale` takes a whole number in range, a `multi` takes an array of option values).
* Clear a value with `KQA.set(id, null)` or `KQA.clear(id)`, and a note with `KQA.setNote(id, "")` or `null`.
* The checker warns if a `custom` question is never set from a script (KQA317): it looks for a call to `KQA.set(` or `KQA.setNote(` anywhere in your scripts. The live check in the app then calls `KQA.set` with a sample value and warns (KQA608) if nothing on the page changes.
* You cannot run the live check from a terminal. Hand-test custom controls: pick a value, reload the page and confirm it is still shown, then check it looks disabled after Submit.

## 5. The KQA runtime

Injected automatically. Available as `window.KQA` once the page loads.

| Member | Description |
|---|---|
| `KQA.ready` | Promise that resolves with `{ answers, locked, questions, participant }` after the app has supplied the saved answers |
| `KQA.get(id)` | Current value, or `undefined` |
| `KQA.getNote(id)` | Current note text, or `undefined` |
| `KQA.set(id, value)` | Set a value. Updates bound controls, saves it, and returns `false` when rejected or locked. Pass `null` to clear |
| `KQA.setNote(id, text)` | Set a note. Pass `""` or `null` to clear it; returns `false` when rejected or locked |
| `KQA.clear(id)` | Same as `KQA.set(id, null)`. Unticks radios and checkboxes and empties text fields; a saved note is kept (clear it with `KQA.setNote(id, "")`). The respondent shell also offers **Clear** beside answered items in pre-submit review; it clears the value and keeps any optional note. Required questions still need an answer before submission |
| `KQA.isAnswered(id)` | `true` when a value is present (non-empty) |
| `KQA.answers()` | Copy of all answers as `{ [id]: { value, note } }` |
| `KQA.progress()` | `{ answered, total }` for currently eligible questions only |
| `KQA.isEligible(id)` | Current routing eligibility for one question. Treat the result as current-rule state, not historical display evidence; query after `KQA.ready` resolves |
| `KQA.eligibility()` | Copy of the current `{ [questionId]: boolean }` eligibility map; query after `KQA.ready` resolves |
| `KQA.on(name, fn)` / `KQA.off(name, fn)` | `"ready"` (snapshot `{ answers, locked, questions, participant }`), `"change"` (payload `{ id, value, note, source }`), `"lock"` (payload `{ locked }`), `"eligibility"` (copy of the full eligibility map, emitted after initial state and when eligibility changes), `"validation"` (payload `{ id, valid, message }` for rejected values and legacy answers that need correction) |
| `KQA.locked` | `true` after Submit |
| `KQA.questions` | The manifest questions |
| `KQA.participant` | `{ name }` of the respondent, or `null` |
| `KQA.preview` | `true` when the host is previewing: nothing is saved |

The runtime also sets `data-kqa-state` on `<html>`: `loading`, `ready`, `locked` or `offline`. Use it to show a message when the answers are locked:

```css
.kq-locked-note { display: none; }
html[data-kqa-state="locked"] .kq-locked-note { display: block; }
```

Runtime errors in your script are collected and reported by the host's live check (KQA600 to KQA607).

### 5.1 Message protocol (for reference)

You never need this to write a questionnaire. It is documented so developers can reason about the boundary. All messages carry `kqa: 1`.

| Direction | `type` | Payload |
|---|---|---|
| frame → app | `hello` | `{ version, manifest }` once the DOM is ready |
| frame → app | `set` | `{ id, value?, note? }` after a change. `null` means cleared |
| frame → app | `error` | `{ message, line?, column?, stack? }` |
| frame → app | `open` | `{ url }` when a link to `https:`, `mailto:` or `tel:` is clicked. The app opens it in a new window with `noopener` |
| frame → app | `probe-result` | results of the live check |
| app → frame | `init` | `{ questions, answers, participant, locked, probe, preview, guided?, guidedSection? }` |
| app → frame | `answers` | `{ answers }` replace all answers |
| frame → app | `eligibility` | `{ eligible }` current routing map after initialization or a route change |
| app → frame | `guided` | `{ enabled, section? }` show one marked section in guided mode or reveal all currently eligible question blocks |
| app → frame | `focus-question` | `{ id }` focus a question; in guided mode the frame reveals its section before focusing it |
| app → frame | `clear-answer` | `{ id }` clear one answer through the normal validation and save path; notes are preserved |
| app → frame | `lock` | `{ locked }` |
| app → frame | `offline` | `{ offline }` |

The app only trusts messages whose `event.source` is its own frame and whose origin is `"null"` (the opaque origin of a sandboxed frame). The frame only trusts messages from its parent.

## 6. What gets stored

Per respondent, in MongoDB collection `participants`:

```json
{
  "token": "sa5IvLoUCw8XWTkOn0K_OvY1",
  "name": "Ada Lovelace",
  "status": "in_progress",
  "answers": {
    "priority": { "value": "accuracy", "note": "Because trust matters most", "updatedAt": "2026-11-13T02:55:11.204Z" },
    "channels": { "value": ["email", "phone"], "updatedAt": "2026-11-13T02:55:14.870Z" },
    "company":  { "value": "Acme Pty Ltd", "updatedAt": "2026-11-13T02:55:20.001Z" }
  },
  "revision": 7
}
```

Answers are keyed by **question id**. That is why ids and option values must stay stable. The survey file itself is stored immutably per version in `survey_versions`, so older exports can always be reproduced.

The app validates every value against the manifest before saving (types, option membership, number ranges, lengths). An invalid value is rejected, never stored, and the page is reset to what is actually saved. A retained full-order ranking is checked against the current option set; after options change, the respondent must confirm an order that includes every current option before submitting.

There is no answer key and no score. "Answered" means a non-empty value: one chosen option, at least one ticked checkbox, or text that is not blank after trimming. A note on its own does not count. An optional email address may be stored on the person so the host can send the private link. That address is not a question in this file, and this file never sends mail.

### Identity and anonymity limits

KQA saves answers under the respondent's participant record and private-link identity. In a multi-person interview, hosts can review answers for each participant and may also store that person's name, email, or private note. Aggregate analysis does not anonymize the underlying records, small groups, combinations of attributes, or free-text answers. One-person mode creates one respondent record; it is not an anonymous cohort mode. The current KQA modes do not provide anonymous collection. If strict anonymity is a requirement, do not describe a KQA interview as anonymous; pause fielding and use a separately verified collection method, or have the accountable host approve and accurately describe another privacy model after checking real access and data flows.

## 7. Replacing a file after people have answered

The host can upload a new version. The app compares it with the current one and the saved answers and reports (KQA7xx):

* A question that disappeared but has answers (KQA700).
* A question whose type changed (KQA701).
* An option that disappeared but was chosen (KQA702).
* A question that looks renamed (KQA703).
* A new required question when people have already submitted (KQA704).
* A respondent presentation change after people have answered; question data remains attached, but step grouping may change context or burden (KQA710).

So: **keep question ids and option values. Change labels, wording, layout and styling freely. Add questions freely. If you must remove or retype a question, say so in your reply.**

## 8. The standard KQA look

The starter template contains KQA's optional questionnaire design kit. It runs inside the sandboxed iframe, separately from the host app; host CSS variables do not cross into the questionnaire. Copy its `<style>` block unchanged, then add rules below it, and keep the Google Fonts `<link>` from its `<head>` (it sits just above the manifest). If you are restyling an existing page that has its own CSS, put the kit first and your own rules after it: later rules win, so your colours and layout take precedence. The kit gives:

* Design tokens as CSS variables: `--bg --surface --surface-2 --ink --ink-2 --muted --line --line-2 --field --brand --accent --accent-soft --accent-ink --focus --danger`, with a dark set under `prefers-color-scheme: dark`.
* IBM Plex Sans and IBM Plex Mono through Google Fonts.
* A contents rail on wide screens (hidden under 900 px), a reading column up to 860 px, question cards, option rows, scale buttons, notes, and a locked-state message.
* Visible focus rings, 16 px base text, 44 px touch targets for scale buttons (the row wraps, so an 11-step 0 to 10 scale works at 360 px), reduced-motion support.

Class names are prefixed `kq-` so they never clash with your own. Use the kit unless the host asks for a different brand.

### Quality bar

* One clear question per card. Plain, friendly language. No jargon the respondent has not been given.
* Put the instruction in `help`, not in the label.
* Mark only genuinely necessary questions as `required`.
* Group long questionnaires into sections of about 5 to 8 questions with a contents rail.
* With the default `presentation: "all"`, the respondent shell adds **Questions** navigation grouped by manifest sections. It shows answered counts and can focus a chosen, currently eligible question. Hidden questions are omitted; their saved answers remain retained and may reappear when eligible.
* With `presentation: "guided"`, KQA shows one currently eligible section at a time with Back and Continue controls. Continue checks required answers and multi-select minimum/maximum limits in that section, preserves answers when navigating, and opens the normal answer review from the last section. A non-empty checkbox answer below `minSelections` blocks Continue and final submission; an optional blank remains a valid skip. Respondents can choose **Show all questions** at any time. Routing can change which sections are available; if the current section becomes empty, KQA moves to the first available section and announces the change without moving focus. If no section is eligible, KQA offers the answer review so the respondent can finish. Guided mode is opt-in and needs the markers above; the questionnaire still supplies the HTML and question styling.
* With `presentation: "guided-question"`, KQA shows one eligible root question at a time in manifest order, with Back and Continue controls. Every question type, including a repeat group, is one root step. Continue checks that question's requiredness and answer constraints; optional unanswered questions can be skipped. Routing can make the current question inactive; KQA advances to an eligible question and announces the change while retaining the inactive answer. If no question is eligible, KQA offers the standard answer review. Sections remain optional organizational metadata; if used, each question's wrapper stays in its matching list. Guided-question mode is opt-in, uses the markers above, and cannot be combined with `questionOrderGroups`.
* When an answer changes routing, the frame announces how many questions are shown or hidden through a concise polite status message; it does not move focus. Pre-submit review keeps inactive answers in a collapsed section so respondents can inspect and clear a retained value or optional note independently. The section is collapsed by default to avoid unexpectedly displaying previously hidden responses; all clear actions are disabled after submission.
* Test at 390 px wide and in dark mode. No sideways scrolling.
* Every interactive element reachable and usable by keyboard, with a visible focus ring.

## 9. Pre-flight checklist

1. One manifest, valid JSON, `"format": "kqa/1"`.
2. Every question has a unique stable `id`, a `type`, a `label`.
3. Option types have at least two options, values match the pattern.
4. Every question has a bound control (or `custom: true` plus a script that calls `KQA.set`).
5. Every control `data-kqa` is a real question id. Every option `value` matches the manifest exactly.
6. No browser storage, script-driven network/API calls, dialogs, frames, file inputs, or navigation away. Resource loads must follow the allowlist in section 2.
7. External resources only from the allowed hosts.
8. `lang`, `<title>`, viewport meta present. Works at 390 px and in dark mode.
9. Run the checker (`npm run check -- file.html` or the app's **Check a file**) and fix every error and warning.
