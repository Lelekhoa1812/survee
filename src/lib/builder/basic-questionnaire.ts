import { isCalendarDate, LIMITS, manifestSchema, type Condition, type QuestionType, type RepeatFieldType } from "@/lib/format/schema";

export type BasicQuestionType = Extract<QuestionType, "single" | "multi" | "select" | "rank" | "text" | "longtext" | "number" | "scale" | "date" | "repeat">;
export type BasicRepeatField = { id: string; type: RepeatFieldType; label: string; help?: string; required?: boolean; options?: Array<{ value: string; label: string }>; min?: number; max?: number; step?: number; maxLength?: number };

export type BasicQuestion = {
  id: string;
  type: BasicQuestionType;
  label: string;
  help: string;
  required: boolean;
  note?: boolean;
  section?: string;
  when?: { all?: Condition[]; any?: Condition[] };
  options?: Array<{ value: string; label: string }>;
  randomizeOptions?: boolean;
  fixedOptionValues?: string[];
  exclusiveOptions?: string[];
  minSelections?: number;
  maxSelections?: number;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  fields?: BasicRepeatField[];
  maxRows?: number;
  minRows?: number;
  itemLabel?: string;
};

export type BasicQuestionSection = { id: string; title: string; description: string };

export type BasicQuestionnaire = {
  title: string;
  description: string;
  language?: string;
  direction?: "ltr" | "rtl" | "auto";
  presentation?: "all" | "guided" | "guided-question";
  sections?: BasicQuestionSection[];
  questions: BasicQuestion[];
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function withOptionalNote(question: BasicQuestion, markup: string): string {
  if (!question.note) return markup;
  const id = escapeHtml(question.id);
  const close = Math.max(markup.lastIndexOf("</fieldset>"), markup.lastIndexOf("</section>"));
  if (close < 0) return markup;
  const field = `<div class="note-control"><label for="note-${id}">Additional comment <span>(optional)</span></label><textarea id="note-${id}" data-kqa-note="${id}" rows="3" maxlength="${LIMITS.noteMax}"></textarea></div>`;
  return `${markup.slice(0, close)}${field}${markup.slice(close)}`;
}

function control(question: BasicQuestion, index: number): string {
  const id = escapeHtml(question.id);
  const label = escapeHtml(question.label);
  const help = question.help ? `<p class="help" id="help-${id}">${escapeHtml(question.help)}</p>` : "";
  const describedBy = question.help ? ` aria-describedby="help-${id}"` : "";
  const required = question.required ? "<span class=\"required\">Required</span>" : "";
  const header = `<div class="question-head"><span class="number" aria-hidden="true">${index + 1}</span><h2 id="heading-${id}">${label}</h2>${required}</div>${help}`;
  const options = (question.options ?? []).map((option, optionIndex) => ({ ...option, value: escapeHtml(option.value), label: escapeHtml(option.label), inputId: `${id}-${optionIndex + 1}` }));

  if (question.type === "single" || question.type === "multi") {
    const type = question.type === "single" ? "radio" : "checkbox";
    const rows = options.map((option) => `<label class="choice" for="${option.inputId}"><input id="${option.inputId}" type="${type}"${question.type === "single" ? ` name="${id}"` : ""} data-kqa="${id}" value="${option.value}"${describedBy}><span>${option.label}</span></label>`).join("\n");
    return withOptionalNote(question, `<fieldset class="question" data-kqa-question-id="${id}" aria-describedby="heading-${id}${question.help ? ` help-${id}` : ""}"><legend class="sr-only">${label}</legend>${header}<div class="choices">${rows}</div></fieldset>`);
  }
  if (question.type === "select") {
    const rows = options.map((option) => `<option value="${option.value}">${option.label}</option>`).join("\n");
    return withOptionalNote(question, `<section class="question" data-kqa-question-id="${id}"><div class="question-head"><span class="number" aria-hidden="true">${index + 1}</span><label for="field-${id}">${label}</label>${required}</div>${help}<select id="field-${id}" data-kqa="${id}"${describedBy}><option value="">Choose one…</option>${rows}</select></section>`);
  }
  if (question.type === "rank") {
    const rows = options.map((option) => `<li data-value="${option.value}">${option.label}</li>`).join("\n");
    return withOptionalNote(question, `<section class="question" data-kqa-question-id="${id}"><div class="question-head"><span class="number" aria-hidden="true">${index + 1}</span><h2 id="heading-${id}">${label}</h2>${required}</div>${help}<p class="rank-hint">Place every option in the order that best answers the question. You can confirm the starting order.</p><ol class="rank" data-kqa="${id}" aria-labelledby="heading-${id}"${question.help ? ` aria-describedby="help-${id}"` : ""}>${rows}</ol></section>`);
  }
  if (question.type === "repeat") {
    const fields = (question.fields ?? []).map((field) => {
      const fieldId = escapeHtml(field.id);
      const fieldLabel = escapeHtml(field.label);
      const common = `data-kqa-repeat-field="${fieldId}"`;
      const bounds = [field.min !== undefined ? ` min="${field.min}"` : "", field.max !== undefined ? ` max="${field.max}"` : "", field.type === "number" && field.step !== undefined ? ` step="${field.step}"` : "", field.maxLength !== undefined ? ` maxlength="${field.maxLength}"` : field.type === "text" ? " maxlength=\"500\"" : field.type === "longtext" ? " maxlength=\"20000\"" : ""].join("");
      const fieldHelp = field.help ? `<span class="field-help">${escapeHtml(field.help)}</span>` : "";
      const legend = `${fieldLabel}${field.required ? " <span class=\"required\">Required</span>" : ""}`;
      if (field.type === "single") {
        const options = (field.options ?? []).map((option) => `<label class="choice"><input type="radio" ${common} value="${escapeHtml(option.value)}"><span>${escapeHtml(option.label)}</span></label>`).join("");
        return `<fieldset class="repeat-field"><legend>${legend}</legend>${fieldHelp}${options}</fieldset>`;
      }
      if (field.type === "select") {
        const options = (field.options ?? []).map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("");
        return `<label class="repeat-field">${legend}${fieldHelp}<select ${common}><option value="">Choose one…</option>${options}</select></label>`;
      }
      if (field.type === "scale") {
        const min = field.min ?? 1;
        const max = field.max ?? 5;
        const options = Array.from({ length: max - min + 1 }, (_, item) => min + item).map((value) => `<label class="scale-choice"><input type="radio" ${common} value="${value}"><span>${value}</span></label>`).join("");
        return `<fieldset class="repeat-field"><legend>${legend}</legend>${fieldHelp}<div class="scale" style="--scale-count:${max - min + 1}">${options}</div></fieldset>`;
      }
      if (field.type === "longtext") return `<label class="repeat-field">${legend}${fieldHelp}<textarea ${common} rows="3"${bounds}></textarea></label>`;
      return `<label class="repeat-field">${legend}${fieldHelp}<input type="${field.type === "text" ? "text" : field.type}" ${common}${bounds}></label>`;
    }).join("\n");
    return withOptionalNote(question, `<section class="question" data-kqa-question-id="${id}"><div class="question-head"><span class="number" aria-hidden="true">${index + 1}</span><h2 id="heading-${id}">${label}</h2>${required}</div>${help}<template data-kqa-repeat-template="${id}"><fieldset><legend>${escapeHtml(question.itemLabel || "Item")}</legend>${fields}</fieldset></template></section>`);
  }
  if (question.type === "scale") {
    const min = question.min ?? 1;
    const max = question.max ?? 5;
    const rows = Array.from({ length: max - min + 1 }, (_, n) => min + n).map((value) => `<label class="scale-choice" for="${id}-${value}"><input id="${id}-${value}" type="radio" name="${id}" data-kqa="${id}" value="${value}"${describedBy}><span>${value}</span></label>`).join("\n");
    return withOptionalNote(question, `<fieldset class="question" data-kqa-question-id="${id}" aria-describedby="heading-${id}${question.help ? ` help-${id}` : ""}"><legend class="sr-only">${label}</legend>${header}<div class="scale" style="--scale-count:${max - min + 1}">${rows}</div></fieldset>`);
  }
  const type = question.type === "longtext" ? "textarea" : "input";
  const inputType = question.type === "longtext" ? "" : ` type="${question.type === "text" ? "text" : question.type}"`;
  const bounds = [question.min !== undefined ? ` min="${question.min}"` : "", question.max !== undefined ? ` max="${question.max}"` : "", question.type === "number" ? ` step="${question.step ?? "any"}"` : question.step !== undefined ? ` step="${question.step}"` : "", question.maxLength !== undefined ? ` maxlength="${question.maxLength}"` : question.type === "text" ? " maxlength=\"500\"" : question.type === "longtext" ? " maxlength=\"20000\"" : ""].join("");
  const field = question.type === "longtext"
    ? `<textarea id="field-${id}" data-kqa="${id}" rows="5"${bounds}${describedBy}></textarea>`
    : `<input id="field-${id}"${inputType} data-kqa="${id}"${bounds}${describedBy}>`;
  return withOptionalNote(question, `<section class="question" data-kqa-question-id="${id}"><div class="question-head"><span class="number" aria-hidden="true">${index + 1}</span><label for="field-${id}">${label}</label>${required}</div>${help}${field}</section>`);
}

/** Generate bounded, portable, script-free HTML for the native question types supported by the composer. */
export function generateBasicQuestionnaireHtml(input: BasicQuestionnaire): string {
  const language = input.language?.trim() || "en-AU";
  let languageTag: string;
  try {
    languageTag = Intl.getCanonicalLocales(language)[0] ?? "";
  } catch {
    languageTag = "";
  }
  if (!languageTag) throw new Error("Enter a valid BCP 47 language tag, such as en-AU or ar.");
  const direction = input.direction ?? "ltr";
  const manifest = {
    format: "kqa/1",
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    ...(input.presentation && input.presentation !== "all" ? { presentation: input.presentation } : {}),
    ...(input.sections?.length ? { sections: input.sections } : {}),
    questions: input.questions.map((question) => ({
      id: question.id,
      type: question.type,
      label: question.label,
      ...(question.section ? { section: question.section } : {}),
      ...(question.when ? { when: question.when } : {}),
      ...(question.help ? { help: question.help } : {}),
      ...(question.required ? { required: true } : {}),
      ...(question.note ? { note: true } : {}),
      ...(["single", "multi", "select", "rank"].includes(question.type) ? { options: question.options } : {}),
      ...(question.randomizeOptions && ["single", "multi", "select"].includes(question.type) ? { randomizeOptions: true } : {}),
      ...(question.randomizeOptions && question.fixedOptionValues?.length && ["single", "multi", "select"].includes(question.type) ? { fixedOptionValues: question.fixedOptionValues } : {}),
      ...(question.type === "multi" && question.exclusiveOptions?.length ? { exclusiveOptions: question.exclusiveOptions } : {}),
      ...(question.minSelections !== undefined ? { minSelections: question.minSelections } : {}),
      ...(question.maxSelections !== undefined ? { maxSelections: question.maxSelections } : {}),
      ...(question.min !== undefined ? { min: question.min } : {}),
      ...(question.max !== undefined ? { max: question.max } : {}),
      ...(question.step !== undefined ? { step: question.step } : {}),
      ...(question.maxLength !== undefined ? { maxLength: question.maxLength } : {}),
      ...(question.type === "repeat" ? { fields: question.fields, maxRows: question.maxRows ?? 5, ...(question.minRows !== undefined ? { minRows: question.minRows } : {}), ...(question.itemLabel ? { itemLabel: question.itemLabel } : {}) } : {}),
    })),
  };
  if (input.presentation === "guided" && (!input.sections?.length || input.questions.some((question) => !question.section))) {
    throw new Error("Section-by-section presentation needs at least one section and every question assigned to a section.");
  }
  const sourceQuestions = new Map(input.questions.map((question) => [question.id, question]));
  for (const question of input.questions) for (const condition of [...(question.when?.all ?? []), ...(question.when?.any ?? [])]) {
    const source = sourceQuestions.get(condition.question);
    if (source?.type === "date" && "value" in condition && (typeof condition.value !== "string" || !isCalendarDate(condition.value))) throw new Error(`Choose a valid date for the routing rule that uses "${source.label}".`);
  }
  const parsed = manifestSchema.safeParse(manifest);
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"));
  const safeJson = JSON.stringify(parsed.data, null, 2).replace(/</g, "\\u003c");
  const questions = input.sections?.length
    ? [
        ...input.sections.map((section) => {
          const controls = input.questions.map((question, index) => ({ question, index })).filter(({ question }) => question.section === section.id).map(({ question, index }) => control(question, index));
          return `<section class="question-section"><header class="section-head"><h2>${escapeHtml(section.title)}</h2>${section.description ? `<p>${escapeHtml(section.description)}</p>` : ""}</header><div data-kqa-question-list="${escapeHtml(section.id)}">${controls.join("\n\n")}</div></section>`;
        }),
        ...input.questions.map((question, index) => ({ question, index })).filter(({ question }) => !question.section).map(({ question, index }) => control(question, index)),
      ].join("\n\n")
    : input.questions.map(control).join("\n\n");
  const html = `<!doctype html>
<html lang="${escapeHtml(languageTag)}" dir="${direction}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root { color-scheme: light dark; font: 16px/1.55 system-ui, sans-serif; --ink:#1d2b27; --muted:#586a64; --paper:#f5f8f6; --card:#fff; --line:#cbd7d1; --accent:#146b50; }
    @media (prefers-color-scheme:dark) { :root { --ink:#edf5f0; --muted:#b0c1b8; --paper:#101b17; --card:#182620; --line:#3a5146; --accent:#8ee0bc; } }
    * { box-sizing:border-box; } body { margin:0; background:var(--paper); color:var(--ink); }
    main { width:min(100% - 32px, 760px); margin:28px auto 72px; }
    header { padding:12px 2px 18px; } h1 { font-size:clamp(1.7rem,5vw,2.4rem); line-height:1.2; margin:0 0 8px; }
    .description { color:var(--muted); margin:0; white-space:pre-wrap; } .question-section { margin:24px 0; } .section-head { margin:0 0 10px; } .section-head h2 { font-size:1.25rem; } .section-head p { color:var(--muted); white-space:pre-wrap; }
    .question { display:block; min-width:0; margin:14px 0; padding:18px; border:1px solid var(--line); border-radius:16px; background:var(--card); }
    .repeat-field { display:grid; gap:6px; margin:12px 0; } .repeat-field label { margin:0; } .repeat-field .required { font-size:.8rem; } .field-help { color:var(--muted); font-size:.9rem; }
    fieldset.question { border:1px solid var(--line); } .question-head { display:flex; align-items:flex-start; gap:10px; margin:0 0 8px; font-weight:650; font-size:1.08rem; }
    .question-head h2,.question-head label { font:inherit; margin:0; } .number { color:var(--accent); font-variant-numeric:tabular-nums; }
    .required { margin-left:auto; color:var(--muted); font-size:.8rem; font-weight:500; white-space:nowrap; }
    .help { margin:4px 0 12px 25px; color:var(--muted); } .choices { display:grid; gap:8px; margin-top:12px; } .note-control { display:grid; gap:5px; margin-top:12px; } .note-control label { font-size:.9rem; font-weight:600; } .note-control label span { color:var(--muted); font-weight:400; }
    .choice { display:flex; align-items:flex-start; gap:10px; padding:9px 10px; border:1px solid var(--line); border-radius:10px; cursor:pointer; }
    input,select,textarea { accent-color:var(--accent); font:inherit; } .choice input,.scale-choice input { margin-top:5px; }
    select,input[type=text],input[type=number],input[type=date],textarea { width:100%; max-width:100%; padding:10px 12px; color:var(--ink); background:var(--card); border:1px solid var(--line); border-radius:9px; }
    textarea { resize:vertical; } .scale { display:grid; grid-template-columns:repeat(var(--scale-count),minmax(0,1fr)); gap:6px; margin-top:12px; }
    .scale-choice { display:grid; justify-items:center; gap:4px; padding:8px 2px; border:1px solid var(--line); border-radius:9px; cursor:pointer; }
    .rank { display:grid; gap:8px; padding-left:2rem; } .rank li { padding:10px; border:1px solid var(--line); border-radius:9px; }
    .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    input:focus-visible,select:focus-visible,textarea:focus-visible,label:focus-within { outline:3px solid var(--accent); outline-offset:2px; }
    @media(max-width:400px) { main { width:calc(100% - 20px); margin-top:14px; } .question { padding:14px; } .scale { gap:3px; } }
  </style>
  <script type="application/json" id="kqa-manifest">${safeJson}</script>
</head>
<body>
  <main>
    <header><h1>${escapeHtml(input.title)}</h1>${input.description ? `<p class="description">${escapeHtml(input.description)}</p>` : ""}</header>
    <div${input.sections?.length ? "" : ' data-kqa-question-list=""'}>
${questions}
    </div>
  </main>
</body>
</html>`;
  if (new TextEncoder().encode(html).byteLength > LIMITS.maxFileBytes) throw new Error(`Generated HTML exceeds the ${LIMITS.maxFileBytes / 1048576} MB file limit. Reduce the number of questions or answer choices.`);
  return html;
}
