"use client";

import { useMemo, useState } from "react";
import { generateBasicQuestionnaireHtml, type BasicQuestion, type BasicQuestionSection, type BasicQuestionType, type BasicQuestionnaire } from "@/lib/builder/basic-questionnaire";

const questionTypes: Array<{ value: BasicQuestionType; label: string }> = [
  { value: "single", label: "Single choice" }, { value: "multi", label: "Checkboxes" }, { value: "select", label: "Dropdown" }, { value: "rank", label: "Full-order ranking" },
  { value: "text", label: "Short text" }, { value: "longtext", label: "Paragraph" }, { value: "number", label: "Number" },
  { value: "scale", label: "Scale" }, { value: "date", label: "Date" },
];

function freshQuestion(index: number): BasicQuestion {
  return { id: `question-${index + 1}`, type: "single", label: "Your question", help: "", required: false, options: [{ value: "option-1", label: "Option 1" }, { value: "option-2", label: "Option 2" }] };
}

export function BasicQuestionnaireBuilder({ onUse }: { onUse: (html: string) => void }) {
  const [data, setData] = useState<BasicQuestionnaire>({ title: "New questionnaire", description: "", questions: [freshQuestion(0)] });
  const [error, setError] = useState("");
  const built = useMemo(() => {
    try { return { html: generateBasicQuestionnaireHtml(data), error: "" }; }
    catch (caught) { return { html: "", error: caught instanceof Error ? caught.message : "Fix the questionnaire fields before continuing." }; }
  }, [data]);

  function updateQuestion(index: number, patch: Partial<BasicQuestion>) {
    setData((current) => ({ ...current, questions: current.questions.map((question, item) => item === index ? { ...question, ...patch } : question) }));
  }

  function addSection() {
    setData((current) => {
      let index = current.sections?.length ?? 0;
      let section: BasicQuestionSection = { id: `section-${index + 1}`, title: `Section ${index + 1}`, description: "" };
      const used = new Set((current.sections ?? []).map((item) => item.id));
      while (used.has(section.id)) section = { ...section, id: `section-${++index + 1}`, title: `Section ${index + 1}` };
      const sections = [...(current.sections ?? []), section];
      const questions = current.sections?.length ? current.questions : current.questions.map((question) => ({ ...question, section: section.id }));
      return { ...current, sections, questions };
    });
  }

  function updateSection(index: number, patch: Partial<BasicQuestionSection>) {
    setData((current) => {
      const previousId = current.sections?.[index]?.id;
      const sections = (current.sections ?? []).map((section, item) => item === index ? { ...section, ...patch } : section);
      const nextId = sections[index]?.id;
      const questions = previousId && nextId && previousId !== nextId
        ? current.questions.map((question) => question.section === previousId ? { ...question, section: nextId } : question)
        : current.questions;
      return { ...current, sections, questions };
    });
  }

  function moveSection(index: number, by: -1 | 1) {
    const next = index + by;
    if (next < 0 || next >= (data.sections?.length ?? 0)) return;
    setData((current) => {
      const sections = [...(current.sections ?? [])];
      [sections[index], sections[next]] = [sections[next], sections[index]];
      return { ...current, sections };
    });
  }

  function removeSection(index: number) {
    setData((current) => {
      const removedId = current.sections?.[index]?.id;
      return {
        ...current,
        sections: (current.sections ?? []).filter((_, item) => item !== index),
        questions: removedId ? current.questions.map((question) => question.section === removedId ? { ...question, section: undefined } : question) : current.questions,
      };
    });
  }

  function changeType(index: number, type: BasicQuestionType) {
    const current = data.questions[index];
    const needsOptions = ["single", "multi", "select", "rank"].includes(type);
    const optionLimit = type === "rank" ? 8 : 50;
    updateQuestion(index, {
      type,
      options: needsOptions ? (current.options.length >= 2 ? current.options.slice(0, optionLimit) : [{ value: "option-1", label: "Option 1" }, { value: "option-2", label: "Option 2" }]) : [],
      min: type === "scale" ? 1 : undefined,
      max: type === "scale" ? 5 : undefined,
      step: undefined,
      maxLength: undefined,
    });
  }

  function move(index: number, by: -1 | 1) {
    const next = index + by;
    if (next < 0 || next >= data.questions.length) return;
    setData((current) => {
      const questions = [...current.questions];
      [questions[index], questions[next]] = [questions[next], questions[index]];
      return { ...current, questions };
    });
  }

  function addQuestion() {
    setData((current) => {
      let index = current.questions.length;
      let question = freshQuestion(index);
      const used = new Set(current.questions.map((item) => item.id));
      while (used.has(question.id)) question = freshQuestion(++index);
      return { ...current, questions: [...current.questions, question] };
    });
  }

  function download() {
    if (!built.html) return;
    const url = URL.createObjectURL(new Blob([built.html], { type: "text/html;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(data.title.trim() || "questionnaire").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "questionnaire"}.html`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="card" aria-labelledby="basic-builder-title">
    <div className="card-head"><div><h2 id="basic-builder-title">Build a basic questionnaire</h2><div className="sub">Create a portable HTML file with common question types. The next step runs the same checker and live probe as uploaded files.</div></div></div>
    <div className="card-pad stack">
      <div className="field"><label htmlFor="builder-title">Questionnaire title</label><input id="builder-title" className="input" maxLength={120} value={data.title} onChange={(event) => setData((current) => ({ ...current, title: event.target.value }))} /></div>
      <div className="field"><label htmlFor="builder-description">Description <span className="muted">(optional)</span></label><textarea id="builder-description" className="textarea" rows={2} maxLength={500} value={data.description} onChange={(event) => setData((current) => ({ ...current, description: event.target.value }))} /></div>
      <div className="stack"><div className="row wrap" style={{ justifyContent: "space-between" }}><div><strong>Sections <span className="muted">(optional)</span></strong><div className="hint">Organize questions for the respondent contents list.</div></div><button className="btn sm" type="button" disabled={(data.sections?.length ?? 0) >= 30} onClick={addSection}>Add section</button></div>
        {(data.sections ?? []).map((section, index) => <fieldset className="card" key={section.id} style={{ padding: 16, margin: 0 }}><legend className="sr-only">Section {index + 1}</legend>
          <div className="row wrap" style={{ justifyContent: "space-between" }}><strong>Section {index + 1}</strong><div className="row"><button className="btn sm" type="button" aria-label={`Move section ${index + 1} up`} disabled={index === 0} onClick={() => moveSection(index, -1)}>Move up</button><button className="btn sm" type="button" aria-label={`Move section ${index + 1} down`} disabled={index === (data.sections?.length ?? 0) - 1} onClick={() => moveSection(index, 1)}>Move down</button><button className="btn danger sm" type="button" onClick={() => removeSection(index)}>Remove</button></div></div>
          <div className="field"><label htmlFor={`builder-section-id-${index}`}>Stable section ID</label><input id={`builder-section-id-${index}`} className="input mono" maxLength={64} pattern="[a-z0-9][a-z0-9_-]{0,63}" value={section.id} onChange={(event) => updateSection(index, { id: event.target.value })} /></div>
          <div className="field"><label htmlFor={`builder-section-title-${index}`}>Section title</label><input id={`builder-section-title-${index}`} className="input" maxLength={120} value={section.title} onChange={(event) => updateSection(index, { title: event.target.value })} /></div>
          <div className="field"><label htmlFor={`builder-section-description-${index}`}>Section description <span className="muted">(optional)</span></label><textarea id={`builder-section-description-${index}`} className="textarea" rows={2} maxLength={1000} value={section.description} onChange={(event) => updateSection(index, { description: event.target.value })} /></div>
        </fieldset>)}
      </div>
      {data.questions.map((question, index) => <fieldset className="card" key={`${index}-${question.id}`} style={{ padding: 16, margin: 0 }}>
        <legend className="sr-only">Question {index + 1}</legend>
        <div className="row wrap" style={{ justifyContent: "space-between", marginBottom: 12 }}><strong>Question {index + 1}</strong><div className="row"><button className="btn sm" type="button" aria-label={`Move question ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>Move up</button><button className="btn sm" type="button" aria-label={`Move question ${index + 1} down`} disabled={index === data.questions.length - 1} onClick={() => move(index, 1)}>Move down</button><button className="btn danger sm" type="button" disabled={data.questions.length === 1} onClick={() => setData((current) => ({ ...current, questions: current.questions.filter((_, item) => item !== index) }))}>Remove</button></div></div>
        <div className="field"><label htmlFor={`builder-id-${index}`}>Stable question ID</label><input id={`builder-id-${index}`} className="input mono" maxLength={64} pattern="[a-z0-9][a-z0-9_-]{0,63}" value={question.id} onChange={(event) => updateQuestion(index, { id: event.target.value })} /><span className="hint">Lowercase letters, numbers, hyphens and underscores. Keep this ID if you revise the file after collecting answers.</span></div>
        <div className="field"><label htmlFor={`builder-type-${index}`}>Answer type</label><select id={`builder-type-${index}`} className="select" value={question.type} onChange={(event) => changeType(index, event.target.value as BasicQuestionType)}>{questionTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></div>
        {(data.sections?.length ?? 0) > 0 && <div className="field"><label htmlFor={`builder-section-${index}`}>Section</label><select id={`builder-section-${index}`} className="select" value={question.section ?? ""} onChange={(event) => updateQuestion(index, { section: event.target.value || undefined })}><option value="">No section</option>{data.sections?.map((section) => <option key={section.id} value={section.id}>{section.title || section.id}</option>)}</select></div>}
        <div className="field"><label htmlFor={`builder-label-${index}`}>Question text</label><input id={`builder-label-${index}`} className="input" maxLength={300} value={question.label} onChange={(event) => updateQuestion(index, { label: event.target.value })} /></div>
        <div className="field"><label htmlFor={`builder-help-${index}`}>Help text <span className="muted">(optional)</span></label><textarea id={`builder-help-${index}`} className="textarea" rows={2} maxLength={1000} value={question.help} onChange={(event) => updateQuestion(index, { help: event.target.value })} /></div>
        <label className="choice"><input type="checkbox" checked={question.required} onChange={(event) => updateQuestion(index, { required: event.target.checked })} /><span>Required to submit</span></label>
        {["single", "multi", "select", "rank"].includes(question.type) && <div className="stack" style={{ marginTop: 14 }}><strong>{question.type === "rank" ? "Ranked options" : "Answer choices"}</strong>{question.options.map((option, optionIndex) => <div className="row wrap" key={optionIndex}>
          <label className="field" style={{ flex: "1 1 130px", margin: 0 }}><span>Stored value</span><input className="input mono" maxLength={64} value={option.value} onChange={(event) => updateQuestion(index, { options: question.options.map((item, i) => i === optionIndex ? { ...item, value: event.target.value } : item) })} /></label>
          <label className="field" style={{ flex: "2 1 180px", margin: 0 }}><span>Displayed label</span><input className="input" maxLength={300} value={option.label} onChange={(event) => updateQuestion(index, { options: question.options.map((item, i) => i === optionIndex ? { ...item, label: event.target.value } : item) })} /></label>
          <button className="btn danger sm" type="button" disabled={question.options.length <= 2} aria-label={`Remove choice ${optionIndex + 1} from question ${index + 1}`} onClick={() => updateQuestion(index, { options: question.options.filter((_, i) => i !== optionIndex) })}>Remove choice</button>
        </div>)}<button className="btn sm" type="button" disabled={question.options.length >= (question.type === "rank" ? 8 : 50)} onClick={() => updateQuestion(index, { options: [...question.options, { value: `option-${question.options.length + 1}`, label: `Option ${question.options.length + 1}` }] })}>Add choice</button>{question.type === "rank" && <span className="hint">Respondents order all 2–8 options; KQA stores the full permutation without scoring responses.</span>}</div>}
        {["number", "scale"].includes(question.type) && <div className="row wrap" style={{ marginTop: 14 }}>
          <label className="field" style={{ flex: "1 1 130px", margin: 0 }}><span>Minimum</span><input className="input" type="number" value={question.min ?? (question.type === "scale" ? 1 : "")} onChange={(event) => updateQuestion(index, { min: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
          <label className="field" style={{ flex: "1 1 130px", margin: 0 }}><span>Maximum</span><input className="input" type="number" value={question.max ?? (question.type === "scale" ? 5 : "")} onChange={(event) => updateQuestion(index, { max: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
        </div>}
      </fieldset>)}
      <div className="row wrap"><button className="btn" type="button" disabled={data.questions.length >= 500} onClick={addQuestion}>Add question</button><span className="muted">{data.questions.length} question{data.questions.length === 1 ? "" : "s"}</span></div>
      <p className="hint">This composer covers common question types, including full-order ranking. For repeat groups, routing, sections, custom controls, or an existing interview version, use the HTML upload workflow so those details stay explicit and reviewable.</p>
      {(built.error || error) && <pre className="callout err" role="alert" style={{ whiteSpace: "pre-wrap" }}>{error || built.error}</pre>}
      <div className="row wrap" style={{ justifyContent: "flex-end" }}><button className="btn" type="button" disabled={!built.html} onClick={download}>Download HTML</button><button className="btn primary" type="button" disabled={!built.html} onClick={() => { setError(""); onUse(built.html); }}>Use questionnaire</button></div>
    </div>
  </section>;
}
