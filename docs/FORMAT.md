# KQA questionnaire format (kqa/1)

This is the complete specification for the HTML file you upload to KQA. If you are an AI agent asked to build a questionnaire for KQA, read this page end to end, then read `AGENT_PLAYBOOK.md`. Start from `template/starter.kqa.html`, which passes the checker as it stands.

KQA gives every respondent a private link, renders your HTML inside a sandboxed frame with the KQA respondent shell and runtime, saves each answer to MongoDB as they go, and lets the host review and export everything. Your file does not talk to the database, and it does not send email. It declares its questions, marks which controls hold which answer, and the KQA runtime does the rest.

The everyday questions are a single choice (`single`), checkboxes (`multi`), a one-line free-text field (`text`, 500 characters unless you set `maxLength`), and a paragraph (`longtext`, 20,000 characters unless you set `maxLength`). Dropdowns (`select`), numbers, scales, and dates are supported as well. Section 3.4 is the full list. KQA does not score answers. A required checkbox is answered when at least one box is ticked. Text that is only spaces is empty.

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
4. When the person presses **Review answers** in the app's top bar, KQA opens a **Check your answers** review. The respondent can see current eligible answers, notes, and any answer that needs attention, then return to edit a question. They can open the review even when required answers are still empty. Submitting locks answers; the host can reopen them. Questions inactive under current routing rules are omitted from the review, and the review explains that their earlier answers are retained and may reappear if they become eligible again.

Your file is therefore three things: a manifest, markup with bindings, and your own look.

## 2. File rules

| Rule | Value |
|---|---|
| Type | One self-contained `.html` file, UTF-8 |
| Size | Up to 3 MB. Do not embed large base64 images or fonts |
| Structure | A full document: `<!doctype html>`, `<html lang="en-AU">`, `<head>`, `<body>` |
| Viewport | `<meta name="viewport" content="width=device-width, initial-scale=1">` |
| Language | `lang` on `<html>` (use `en-AU` unless told otherwise) |
| Title | A `<title>` element |
| Layout | Must work from 360 px wide up with no sideways scrolling. Respondents use phones. Test at 390 px |
| Colour | Light and dark via `prefers-color-scheme` |
| Frames and navigation | No `<iframe>`, `<object>`, `<embed>`, `<base>`, meta refresh or links that leave the page |

### Optional markers for source-preserving MCP edits

These markers do not change how KQA displays or saves answers. They let an MCP agent edit a question's manifest entry and HTML block without rewriting the rest of the uploaded file:

* Put `data-kqa-question-list="SECTION_ID"` on the element that directly contains a section's question blocks. Use an empty value (`data-kqa-question-list=""`) for questions without a section.
* Put `data-kqa-question-id="QUESTION_ID"` on the single root element for each question block. That element must be a direct child of its matching marked list.

The markers are optional for ordinary uploads and full-file questionnaire edits. `preview_questionnaire_block_patch` requires them for targeted edits and supports ordinary, non-custom questions only. It accepts one root element per added or replacement block and rejects scripts and inline event-handler attributes in those fragments. It can move a marked question between sections and place an added or moved question before or after an unchanged question in the same section. It does not infer custom JavaScript behavior. If the markers are absent, duplicated, or out of sync with the manifest, use the complete-file preview and apply workflow in `MCP.md`.

### What the sandbox allows

The page runs in an iframe with `sandbox="allow-scripts allow-forms"` and a strict Content-Security-Policy. In practice:

* **Scripts** run, from inline `<script>` or from `cdnjs.cloudflare.com`, `cdn.jsdelivr.net` or `unpkg.com` only.
* **Styles** may be inline, or `fonts.googleapis.com` / `cdnjs.cloudflare.com` stylesheets. **Fonts** load from `fonts.gstatic.com`.
* **Images** can be embedded as `data:` URIs or inline `<svg>`, or saved in the workspace image library. Upload images in Settings or with the MCP image tools, then use the returned `/api/assets/<id>` URL in `<img src>` or CSS `url()`. Remote image hosts do not load (KQA417); relative files such as `./logo.png` are not included with the questionnaire (KQA418). Inline SVG is a good choice for small logos and icons.
* **No network calls.** `fetch`, `XMLHttpRequest`, WebSocket and form posts are blocked (`connect-src 'none'`, `form-action 'none'`). All data goes through `KQA`.
* **No browser storage.** `localStorage`, `sessionStorage`, cookies and IndexedDB are unavailable because the frame has an opaque origin. Do not use them. Use `KQA.set` / `KQA.get`.
* **No modal dialogs.** `alert`, `confirm`, `prompt` do not work in a sandboxed frame. Build inline UI.
* **No file inputs, downloads, printing, clipboard access or `window.open`.** Copy-to-clipboard buttons do not work, so leave them out.
* **Links:** a link to `https://`, `mailto:` or `tel:` opens in a new window through the app (with no connection back to the page), so ordinary `<a href="https://…">` links work. Links to other files do not, and `#section` links scroll within the page. Do not navigate the page with script (`location`, `history`).

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
| `sections` | no | Up to 50. Groups and orders questions in exports and the answers view |
| `questions` | yes | 1 to 500 questions, in the order they should appear in exports |

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
| `type` | yes | all | `single`, `multi`, `select`, `text`, `longtext`, `number`, `scale`, `date` |
| `label` | yes | all | The question text. Up to 300 characters. Used in the host's answers view and every export |
| `help` | no | all | Up to 1000 characters |
| `section` | no | all | Must be the `id` of a declared section |
| `required` | no | all | `true` blocks Submit until answered. Default `false` |
| `options` | yes for `single`, `multi`, `select` | those three | 2 to 50 items of `{ "value", "label" }`. Not allowed on other types |
| `maxSelections` | no | `multi` | Maximum distinct checked options, from 1 through the number of options. Omit for no maximum. It does not set a minimum or change requiredness |
| `note` | no | all | `true`, or `{ "label", "placeholder", "maxLength" }`. Enables an optional free-text note stored beside the answer. Up to 5000 characters |
| `min`, `max` | no | `number`, `scale` | `scale` defaults to 1 to 5 and uses safely representable whole-number bounds, with `min` below `max` and a span of at most 20 steps |
| `step` | no | `number`, `scale` | Positive number |
| `maxLength` | no | `text`, `longtext` | Default 500 for `text`, 20000 for `longtext` |
| `custom` | no | all | `true` when the answer is set from script with `KQA.set()` and has no `data-kqa` control |
| `when` | no | all | Bounded visibility rule. Use `all` and/or `any`, each with 1 to 20 conditions. Conditions compare an earlier `single`/`select` answer using `equals` or `notEquals`, or an earlier `multi` answer using `contains` or `notContains` |

Option `value` rules: starts with a letter or digit, then letters, digits, `.`, `_`, `:` or `-`, up to 64 characters (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`). Values are what is stored. Labels are what people see in the host's views and exports. Keep values short, lowercase and stable.

Routing conditions are intentionally declarative: they cannot contain scripts, nested expressions, or comparisons to free text, numbers, dates or scales. Every referenced question must appear earlier in the manifest and the compared value must be one of its declared option values. When both lists are present, every `all` condition and at least one `any` condition must match; when only one list is present, that list determines visibility. A missing or ineligible source answer does not match. When a parent answer changes, KQA recomputes downstream eligibility in manifest order. The respondent runtime hides, makes inert, and disables controls in an ineligible question block; therefore wrap each routed question in one whole-question element with `data-kqa-question-id="QUESTION_ID"`. Do not put multiple questions in the same marked block. Hidden questions remain in the interview's data model; their answers are retained if a condition later changes. Requiredness and progress apply only while a question is eligible. The server rejects new non-empty values or notes for currently inactive questions, while allowing a respondent to clear a retained value.

For example, after a `priority` single-choice question, a follow-up can use `{ "when": { "all": [{ "question": "priority", "operator": "equals", "value": "accuracy" }] } }`. A multi-choice source uses `contains` or `notContains` instead. Keep each condition list to 20 items or fewer.

See the complete [`routed-follow-up.kqa.html`](examples/routed-follow-up.kqa.html) example for an eligible required follow-up, respondent disclosure, and stable saved-answer behavior.

When the labels are long sentences, use a short meaningful slug (`agree-with-suggestion`, `prefer-phased-rollout`) or a positional key (`o1`, `o2`, `o3`) that you never reorder or reuse. Never use the sentence itself as the value.

The order of questions on the page does not have to match the manifest. The manifest order is the order in exports and the answers view.

Unknown fields are ignored with a warning (KQA216), so a typo in a field name silently does nothing. Check the spelling.

**Label and help.** `label` is the question itself and must make sense on its own, because the host reads it in exports without the page around it. `help` is the instruction to the respondent ("Pick one", "Tick all that apply"). Read-only background text can stay in the page only; it does not need to be repeated in `help`.

For a capped checkbox group, set `maxSelections` and state the same limit in `help` (for example, "Choose up to 3"). The runtime adds visible guidance and rejects additional selections. Existing saved answers above a newly lowered cap stay visible; respondents can remove choices and save each reduction until within the cap. Submission remains blocked until the current eligible answer is within the limit. KQA never silently truncates saved answers.

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
| Anything else (ranking, drag and drop, matrix, sliders with custom UI) | any type + `custom: true` | your own markup that calls `KQA.set` |

A matrix such as "rate each of these five items" is **five questions**, one per row, usually `scale` or `single` with the same options. KQA has no native ranking type, and `multi` does not preserve rank order. If a strict order is essential, a `custom` question may store a documented representation such as `"a>c>b"`; the author must provide an accessible interaction and validate the ordering because KQA does not enforce a permutation. Otherwise, ask a different question and explain the tradeoff.

## 4. Binding controls

Bind a control to a question by giving it `data-kqa="<question id>"`. The runtime listens for `input` and `change` events on bound controls.

| Type | Markup | Stored value |
|---|---|---|
| `single` | Several `<input type="radio" data-kqa="ID" name="ID" value="OPTION">`, one per option. Same `name`. | the chosen option `value` (string) |
| `multi` | Several `<input type="checkbox" data-kqa="ID" value="OPTION">` | array of chosen option values, in manifest order; `maxSelections` limits the distinct values |
| `select` | `<select data-kqa="ID">` with `<option value="OPTION">`. Keep a first `<option value="">` as the placeholder | the chosen option value |
| `text` | `<input type="text" data-kqa="ID">` | string, trimmed-empty clears |
| `longtext` | `<textarea data-kqa="ID">` | string |
| `number` | `<input type="number" data-kqa="ID" min max step>` | finite number within `min`/`max` |
| `scale` | `<input type="radio" data-kqa="ID" name="ID" value="1">` … one radio per integer, or `<input type="range" data-kqa="ID" min max step>` | integer within the scale |
| `date` | `<input type="date" data-kqa="ID">` | real calendar date as `YYYY-MM-DD`, years 0001–9999 |

Rules the checker enforces:

* **Every manifest question needs a control**, unless it is `custom: true` (KQA300).
* **Every `data-kqa` must name a manifest question** (KQA301). A typo here means the answer is never saved.
* **The control type must match the question type** (KQA302). A `single` question cannot be a text box.
* **Every option value in the page must exist in the manifest, and every manifest option must have a control** (KQA303, KQA304). Compare them character for character, including case.
* Radios of one question share one `name`, and radios of different questions never share a name (KQA307, KQA319).
* Radio and checkbox controls that carry `data-kqa` need a `value` attribute (KQA312). Unbound inputs (a filter toggle, a presentation-only slider) are ignored by the checker and may be used freely, but they save nothing.
* `data-kqa` goes on `input`, `select` or `textarea`, not on a `div` or `label` (KQA309).
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

### 4.2 Status ticks

Optionally mark an element that reflects whether a question is answered:

```html
<span class="kq-tick" data-kqa-status="priority" aria-hidden="true"></span>
```

The runtime sets `data-state="answered"` or `data-state="empty"`. Style it with `[data-state="answered"]`.

### 4.3 Custom questions

When the standard controls are not enough, set `"custom": true`, build your own UI, and talk to the runtime. Three rules make a custom control work: **write** with `KQA.set`, **read** with `KQA.get`, and **repaint** whenever `ready`, `change` or `lock` fires. The repaint rule matters most. It is how a person who returns to their link sees their earlier answer. `KQA.set` and `KQA.clear` return `false` when a value is rejected; listen for `KQA.on("validation", ...)` to show or clear field-level feedback. A custom `multi` control must enforce `maxSelections` itself and explain any rejection to the respondent.

```js
// A five-star control for a custom question with id "stars" (type scale, min 1, max 5)
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
| `KQA.clear(id)` | Same as `KQA.set(id, null)`. Unticks radios and checkboxes and empties text fields (a saved note is kept; clear it with `KQA.setNote(id, "")`). A respondent cannot untick a radio by themselves, so offer a "Clear" button that calls this if people may need to withdraw an answer |
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
| app → frame | `init` | `{ questions, answers, participant, locked, probe, preview }` |
| app → frame | `answers` | `{ answers }` replace all answers |
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

The app validates every value against the manifest before saving (types, option membership, number ranges, lengths). An invalid value is rejected, never stored, and the page is reset to what is actually saved.

There is no answer key and no score. "Answered" means a non-empty value: one chosen option, at least one ticked checkbox, or text that is not blank after trimming. A note on its own does not count. An optional email address may be stored on the person so the host can send the private link. That address is not a question in this file, and this file never sends mail.

## 7. Replacing a file after people have answered

The host can upload a new version. The app compares it with the current one and the saved answers and reports (KQA7xx):

* A question that disappeared but has answers (KQA700).
* A question whose type changed (KQA701).
* An option that disappeared but was chosen (KQA702).
* A question that looks renamed (KQA703).
* A new required question when people have already submitted (KQA704).

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
* Test at 390 px wide and in dark mode. No sideways scrolling.
* Every interactive element reachable and usable by keyboard, with a visible focus ring.

## 9. Pre-flight checklist

1. One manifest, valid JSON, `"format": "kqa/1"`.
2. Every question has a unique stable `id`, a `type`, a `label`.
3. Option types have at least two options, values match the pattern.
4. Every question has a bound control (or `custom: true` plus a script that calls `KQA.set`).
5. Every control `data-kqa` is a real question id. Every option `value` matches the manifest exactly.
6. No storage, no network, no dialogs, no frames, no file inputs, no navigation away.
7. External resources only from the allowed hosts.
8. `lang`, `<title>`, viewport meta present. Works at 390 px and in dark mode.
9. Run the checker (`npm run check -- file.html` or the app's **Check a file**) and fix every error and warning.
