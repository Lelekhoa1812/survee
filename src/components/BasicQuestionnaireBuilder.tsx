"use client";

import { useMemo, useState } from "react";
import { generateBasicQuestionnaireHtml, type BasicQuestion, type BasicQuestionSection, type BasicQuestionType, type BasicQuestionnaire, type BasicQuestionOrderGroup, type BasicRepeatField } from "@/lib/builder/basic-questionnaire";
import type { Condition } from "@/lib/format/schema";

const questionTypes: Array<{ value: BasicQuestionType; label: string }> = [
  { value: "single", label: "Single choice" }, { value: "multi", label: "Checkboxes" }, { value: "select", label: "Dropdown" }, { value: "rank", label: "Full-order ranking" }, { value: "repeat", label: "Repeatable records" },
  { value: "text", label: "Short text" }, { value: "longtext", label: "Paragraph" }, { value: "number", label: "Number" },
  { value: "scale", label: "Scale" }, { value: "date", label: "Date" },
];

function freshQuestion(index: number): BasicQuestion {
  return { id: `question-${index + 1}`, type: "single", label: "Your question", help: "", required: false, options: [{ value: "option-1", label: "Option 1" }, { value: "option-2", label: "Option 2" }] };
}

function freshRepeatField(index: number): BasicRepeatField {
  return { id: `field-${index + 1}`, type: "text", label: `Field ${index + 1}` };
}

type RouteGroup = "all" | "any";

function routeConditions(question: BasicQuestion, group: RouteGroup): Condition[] {
  return question.when?.[group] ?? [];
}

function routeCondition(question: BasicQuestion, conditionIndex: number, group: RouteGroup): Condition | undefined {
  return routeConditions(question, group)[conditionIndex];
}

export function BasicQuestionnaireBuilder({ onUse }: { onUse: (html: string) => void }) {
  const [data, setData] = useState<BasicQuestionnaire>({ title: "New questionnaire", description: "", presentation: "all", questions: [freshQuestion(0)] });
  const [error, setError] = useState("");
  const [selectedOrderQuestionIds, setSelectedOrderQuestionIds] = useState<string[]>([]);
  const built = useMemo(() => {
    try { return { html: generateBasicQuestionnaireHtml(data), error: "" }; }
    catch (caught) { return { html: "", error: caught instanceof Error ? caught.message : "Fix the questionnaire fields before continuing." }; }
  }, [data]);

  function updateQuestion(index: number, patch: Partial<BasicQuestion>) {
    setError("");
    setData((current) => {
      const previousId = current.questions[index]?.id;
      const nextId = patch.id ?? previousId;
      return {
        ...current,
        questionOrderGroups: current.questionOrderGroups?.map((group) => ({ ...group, questionIds: group.questionIds.map((id) => id === previousId ? nextId ?? id : id) })),
        questions: current.questions.map((question, item) => {
          if (item === index) {
            const updated = { ...question, ...patch };
            if (patch.options && question.options) {
              const nextValues = new Set(patch.options.map((option) => option.value));
              const remapChoiceValue = (value: string) => {
                if (nextValues.has(value)) return value;
                const oldOption = question.options!.find((option) => option.value === value);
                if (!oldOption) return value;
                const matching = patch.options!.filter((option) => option.label === oldOption.label);
                // A unique unchanged label is a safe identity for a stored-value rename.
                // Otherwise retain the old value so the dependent rule is visible and can
                // be repaired explicitly instead of guessing from option order.
                return matching.length === 1 ? matching[0].value : value;
              };
              const remap = (values: string[] | undefined) => {
                if (!values) return undefined;
                return values.map((value) => {
                  const updatedValue = remapChoiceValue(value);
                  return nextValues.has(updatedValue) ? updatedValue : null;
                }).filter((value): value is string => value !== null);
              };
              updated.fixedOptionValues = remap(question.fixedOptionValues);
              updated.exclusiveOptions = remap(question.exclusiveOptions);
            }
            return updated;
          }
          if (!previousId || !nextId || !question.when) return question;
          const replace = (condition: Condition): Condition => {
            if (condition.question !== previousId) return condition;
            let updated: Condition = previousId === nextId ? condition : { ...condition, question: nextId };
            const sourceOptions = current.questions[index]?.options;
            if (patch.options && sourceOptions && "value" in condition && typeof condition.value === "string") {
              const oldOption = sourceOptions.find((option) => option.value === condition.value);
              const matches = oldOption ? patch.options.filter((option) => option.label === oldOption.label) : [];
              if (matches.length === 1) updated = { ...updated, value: matches[0].value } as Condition;
            }
            return updated;
          };
          return { ...question, when: { ...question.when, ...(question.when.all ? { all: question.when.all.map(replace) } : {}), ...(question.when.any ? { any: question.when.any.map(replace) } : {}) } };
        }),
      };
    });
  }

  function setRouteCondition(index: number, group: RouteGroup, conditionIndex: number, condition?: Condition) {
    setData((current) => {
      const question = current.questions[index];
      if (!question) return current;
      const conditions = [...routeConditions(question, group)];
      if (condition) conditions[conditionIndex] = condition;
      else conditions.splice(conditionIndex, 1);
      const when = { ...question.when };
      if (conditions.length) when[group] = conditions;
      else delete when[group];
      const nextWhen = when.all?.length || when.any?.length ? when : undefined;
      return { ...current, questions: current.questions.map((item, itemIndex) => itemIndex === index ? { ...item, when: nextWhen } : item) };
    });
  }

  function selectRouteSource(index: number, group: RouteGroup, sourceId: string, conditionIndex = 0) {
    if ((data.questionOrderGroups ?? []).some((orderGroup) => orderGroup.questionIds.includes(sourceId))) return;
    const source = data.questions.slice(0, index).find((question) => question.id === sourceId);
    if (!source) return setRouteCondition(index, group, conditionIndex);
    const choice = ["single", "multi", "select"].includes(source.type);
    const condition = choice
      ? { question: source.id, operator: source.type === "multi" ? "contains" as const : "equals" as const, value: source.options?.[0]?.value ?? "" }
      : ["number", "scale"].includes(source.type)
        ? { question: source.id, operator: "gte" as const, value: source.min ?? (source.type === "scale" ? 1 : 0) }
        : source.type === "date"
          ? { question: source.id, operator: "gte" as const, value: "" }
          : { question: source.id, operator: "answered" as const };
    setRouteCondition(index, group, conditionIndex, condition);
  }

  function selectRouteOperator(index: number, group: RouteGroup, sourceId: string, operator: string, conditionIndex = 0) {
    const source = data.questions.slice(0, index).find((question) => question.id === sourceId);
    if (!source) return;
    if (operator === "answered" || operator === "notAnswered") {
      setRouteCondition(index, group, conditionIndex, { question: source.id, operator });
      return;
    }
    const currentCondition = routeCondition(data.questions[index], conditionIndex, group);
    const value = currentCondition && "value" in currentCondition ? currentCondition.value : undefined;
    if (["number", "scale"].includes(source.type)) {
      setRouteCondition(index, group, conditionIndex, { question: source.id, operator: operator as "lt" | "lte" | "gt" | "gte" | "eq" | "ne", value: typeof value === "number" ? value : source.min ?? (source.type === "scale" ? 1 : 0) });
    } else if (source.type === "date") {
      setRouteCondition(index, group, conditionIndex, { question: source.id, operator: operator as "lt" | "lte" | "gt" | "gte" | "eq" | "ne", value: typeof value === "string" ? value : "" });
    } else {
      setRouteCondition(index, group, conditionIndex, { question: source.id, operator: operator as "equals" | "notEquals" | "contains" | "notContains", value: typeof value === "string" ? value : source.options?.[0]?.value ?? "" });
    }
  }

  function addRouteCondition(index: number, group: RouteGroup) {
    const source = data.questions.slice(0, index).reverse().find((question) => !(data.questionOrderGroups ?? []).some((orderGroup) => orderGroup.questionIds.includes(question.id)));
    const conditions = routeConditions(data.questions[index], group);
    if (!source || conditions.length >= 20) return;
    selectRouteSource(index, group, source.id, conditions.length);
  }

  function renderRouteCondition(index: number, group: RouteGroup, conditionIndex: number) {
    const question = data.questions[index];
    const condition = routeCondition(question, conditionIndex, group);
    if (!condition) return null;
    const source = data.questions.slice(0, index).find((item) => item.id === condition.question);
    if (!source) return <p className="hint">Choose an earlier question to continue this rule.</p>;
    const hasChoices = ["single", "multi", "select"].includes(source.type);
    const hasTypedComparison = ["number", "scale", "date"].includes(source.type);
    const operators = hasChoices
      ? [{ value: "answered", label: "has an answer" }, { value: "notAnswered", label: "has no answer" }, ...(source.type === "multi" ? [{ value: "contains", label: "contains this choice" }, { value: "notContains", label: "does not contain this choice" }] : [{ value: "equals", label: "equals this choice" }, { value: "notEquals", label: "does not equal this choice" }])]
      : hasTypedComparison
        ? [{ value: "answered", label: "has an answer" }, { value: "notAnswered", label: "has no answer" }, { value: "lt", label: "is less than" }, { value: "lte", label: "is at most" }, { value: "gt", label: "is greater than" }, { value: "gte", label: "is at least" }, { value: "eq", label: "equals" }, { value: "ne", label: "does not equal" }]
        : [{ value: "answered", label: "has an answer" }, { value: "notAnswered", label: "has no answer" }];
    const value = "value" in condition ? condition.value : "";
    const choiceRule = ["equals", "notEquals", "contains", "notContains"].includes(condition.operator);
    const typedRule = ["lt", "lte", "gt", "gte", "eq", "ne"].includes(condition.operator);
    const missingChoice = hasChoices && choiceRule && typeof value === "string" && !(source.options ?? []).some((option) => option.value === value);
    return <div className="row wrap"><label className="field" style={{ flex: "1 1 180px", margin: 0 }}><span>Rule</span><select className="select" value={condition.operator} onChange={(event) => selectRouteOperator(index, group, source.id, event.target.value, conditionIndex)}>{operators.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}</select></label>
      {hasChoices && choiceRule && <label className="field" style={{ flex: "1 1 180px", margin: 0 }}><span>Choice</span><select className="select" value={typeof value === "string" ? value : ""} onChange={(event) => setRouteCondition(index, group, conditionIndex, { question: source.id, operator: condition.operator as "equals" | "notEquals" | "contains" | "notContains", value: event.target.value })}>{missingChoice && <option value={value} disabled>Missing choice: {value}</option>}{(source.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{missingChoice && <span className="hint">This choice was removed or changed. Choose a current value or remove this rule before using the questionnaire.</span>}</label>}
      {hasTypedComparison && typedRule && <label className="field" style={{ flex: "1 1 180px", margin: 0 }}><span>{source.type === "date" ? "Date" : "Value"}</span><input className="input" type={source.type === "date" ? "date" : "number"} step={source.type === "number" ? source.step ?? "any" : undefined} value={typeof value === "number" || typeof value === "string" ? value : ""} onChange={(event) => { if (source.type !== "date" && event.target.value === "") return; setRouteCondition(index, group, conditionIndex, { question: source.id, operator: condition.operator as "lt" | "lte" | "gt" | "gte" | "eq" | "ne", value: source.type === "date" ? event.target.value : Number(event.target.value) }); }} /></label>}
    </div>;
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

  function changePresentation(presentation: NonNullable<BasicQuestionnaire["presentation"]>) {
    setData((current) => {
      if (presentation !== "guided") return { ...current, presentation, ...(presentation === "all" ? {} : { questionOrderGroups: undefined }) };
      let sections = current.sections ?? [];
      if (!sections.length) sections = [{ id: "section-1", title: "Section 1", description: "" }];
      const questions = current.questions.map((question) => question.section ? question : { ...question, section: sections[0].id });
      return { ...current, presentation, sections, questions, questionOrderGroups: undefined };
    });
  }

  function changeType(index: number, type: BasicQuestionType) {
    const current = data.questions[index];
    const needsOptions = ["single", "multi", "select", "rank"].includes(type);
    const optionLimit = type === "rank" ? 8 : 50;
    updateQuestion(index, {
      type,
      note: type === "repeat" ? undefined : current.note,
      options: needsOptions ? ((current.options ?? []).length >= 2 ? current.options!.slice(0, optionLimit) : [{ value: "option-1", label: "Option 1" }, { value: "option-2", label: "Option 2" }]) : [],
      randomizeOptions: ["single", "multi", "select"].includes(type) ? current.randomizeOptions : undefined,
      fixedOptionValues: ["single", "multi", "select"].includes(type) ? current.fixedOptionValues : undefined,
      exclusiveOptions: type === "multi" ? current.exclusiveOptions : undefined,
      min: type === "scale" ? 1 : undefined,
      max: type === "scale" ? 5 : undefined,
      minSelections: type === "multi" ? current.minSelections : undefined,
      maxSelections: type === "multi" ? current.maxSelections : undefined,
      step: undefined,
      maxLength: undefined,
      fields: type === "repeat" ? current.fields ?? [freshRepeatField(0)] : undefined,
      maxRows: type === "repeat" ? current.maxRows ?? 5 : undefined,
      minRows: type === "repeat" ? current.minRows : undefined,
      itemLabel: type === "repeat" ? current.itemLabel ?? "item" : undefined,
    });
  }

  function updateRepeatField(index: number, fieldIndex: number, patch: Partial<BasicRepeatField>) {
    const fields = data.questions[index]?.fields ?? [];
    const field = fields[fieldIndex];
    if (!field) return;
    const nextType = patch.type ?? field.type;
    const needsOptions = nextType === "single" || nextType === "select";
    const options = needsOptions ? (patch.options ?? (field.options?.length ? field.options : [{ value: "option-1", label: "Option 1" }, { value: "option-2", label: "Option 2" }])) : undefined;
    updateQuestion(index, { fields: fields.map((item, itemIndex) => itemIndex === fieldIndex ? { ...item, ...patch, options, min: nextType === "scale" ? item.min ?? 1 : nextType === "number" ? item.min : undefined, max: nextType === "scale" ? item.max ?? 5 : nextType === "number" ? item.max : undefined, step: nextType === "number" ? item.step : undefined, maxLength: ["text", "longtext"].includes(nextType) ? item.maxLength : undefined } : item) });
  }

  function addRepeatField(index: number) {
    setData((current) => ({
      ...current,
      questions: current.questions.map((question, questionIndex) => {
        if (questionIndex !== index) return question;
        const fields = question.fields ?? [];
        let fieldIndex = 0;
        while (fields.some((field) => field.id === `field-${fieldIndex + 1}`)) fieldIndex += 1;
        return { ...question, fields: [...fields, freshRepeatField(fieldIndex)] };
      }),
    }));
  }

  function questionOrderKeepsRoutes(questions: BasicQuestion[]) {
    const positions = new Map(questions.map((question, index) => [question.id, index]));
    return questions.every((question, index) => [...(question.when?.all ?? []), ...(question.when?.any ?? [])]
      .every((condition) => (positions.get(condition.question) ?? Number.MAX_SAFE_INTEGER) < index));
  }

  function questionOrderGroupsValid(questions: BasicQuestion[], groups = data.questionOrderGroups ?? []) {
    const positions = new Map(questions.map((question, index) => [question.id, index]));
    return groups.every((group) => {
      const indexes = group.questionIds.map((id) => positions.get(id));
      if (indexes.some((index) => index === undefined)) return false;
      const members = group.questionIds.map((id) => questions.find((question) => question.id === id)!);
      const first = indexes[0]!;
      return indexes.every((index, offset) => index === first + offset)
        && members.every((question) => question.section === members[0].section && !question.when)
        && !questions.some((question) => [...(question.when?.all ?? []), ...(question.when?.any ?? [])].some((condition) => group.questionIds.includes(condition.question)));
    });
  }

  function questionOrderGroupEligibility(question: BasicQuestion): string | undefined {
    if (data.presentation !== "all") return "Question-order groups require all questions on one page.";
    if (question.when) return "Questions with routing conditions cannot be grouped.";
    if ((data.questionOrderGroups ?? []).some((group) => group.questionIds.includes(question.id))) return "This question is already in an order group.";
    if (data.questions.some((candidate) => [...(candidate.when?.all ?? []), ...(candidate.when?.any ?? [])].some((condition) => condition.question === question.id))) return "A question used by routing cannot be grouped.";
    return undefined;
  }

  function selectedOrderGroupProblem(): string {
    if (selectedOrderQuestionIds.length < 2) return "Select at least two adjacent questions.";
    const selected = data.questions.filter((question) => selectedOrderQuestionIds.includes(question.id));
    if (selected.length !== selectedOrderQuestionIds.length) return "Selection changed; choose the questions again.";
    const indexes = selected.map((question) => data.questions.indexOf(question));
    if (Math.max(...indexes) - Math.min(...indexes) + 1 !== indexes.length) return "Selected questions must be adjacent in manifest order.";
    const blocked = selected.map(questionOrderGroupEligibility).find(Boolean);
    if (blocked) return blocked;
    if (selected.some((question) => question.section !== selected[0].section)) return "Selected questions must all be in the same section, or all have no section.";
    return "";
  }

  function addQuestionOrderGroup() {
    if (selectedOrderGroupProblem()) return;
    setData((current) => {
      const selected = current.questions.filter((question) => selectedOrderQuestionIds.includes(question.id));
      let suffix = 1;
      const used = new Set((current.questionOrderGroups ?? []).map((group) => group.id));
      while (used.has(`question-order-${suffix}`)) suffix += 1;
      const group: BasicQuestionOrderGroup = { id: `question-order-${suffix}`, questionIds: selected.map((question) => question.id) };
      return { ...current, questionOrderGroups: [...(current.questionOrderGroups ?? []), group] };
    });
    setSelectedOrderQuestionIds([]);
  }

  function removeQuestionOrderGroup(id: string) {
    setData((current) => ({ ...current, questionOrderGroups: current.questionOrderGroups?.filter((group) => group.id !== id) }));
  }

  function removeQuestion(index: number) {
    setData((current) => {
      const removedId = current.questions[index]?.id;
      const questions = current.questions.filter((_, item) => item !== index);
      const questionOrderGroups = current.questionOrderGroups?.map((group) => ({ ...group, questionIds: group.questionIds.filter((id) => id !== removedId) })).filter((group) => group.questionIds.length >= 2);
      return { ...current, questions, questionOrderGroups };
    });
    setSelectedOrderQuestionIds((current) => current.filter((id) => id !== data.questions[index]?.id));
  }

  function canMoveQuestion(index: number, by: -1 | 1) {
    if ((data.questionOrderGroups ?? []).some((group) => group.questionIds.includes(data.questions[index]?.id))) return false;
    const next = index + by;
    if (next < 0 || next >= data.questions.length) return false;
    const questions = [...data.questions];
    [questions[index], questions[next]] = [questions[next], questions[index]];
    return questionOrderKeepsRoutes(questions) && questionOrderGroupsValid(questions);
  }

  function move(index: number, by: -1 | 1) {
    setData((current) => {
      const next = index + by;
      if (next < 0 || next >= current.questions.length) return current;
      const questions = [...current.questions];
      [questions[index], questions[next]] = [questions[next], questions[index]];
      if (!questionOrderKeepsRoutes(questions) || !questionOrderGroupsValid(questions, current.questionOrderGroups)) return current;
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

  function addOption(index: number) {
    const options = data.questions[index]?.options ?? [];
    let valueIndex = 1;
    while (options.some((option) => option.value === `option-${valueIndex}`)) valueIndex += 1;
    updateQuestion(index, { options: [...options, { value: `option-${valueIndex}`, label: `Option ${valueIndex}` }] });
  }

  function moveOption(questionIndex: number, optionIndex: number, delta: -1 | 1) {
    const options = [...(data.questions[questionIndex]?.options ?? [])];
    const target = optionIndex + delta;
    if (target < 0 || target >= options.length) return;
    [options[optionIndex], options[target]] = [options[target], options[optionIndex]];
    updateQuestion(questionIndex, { options });
  }

  function moveRepeatField(questionIndex: number, fieldIndex: number, delta: -1 | 1) {
    const fields = [...(data.questions[questionIndex]?.fields ?? [])];
    const target = fieldIndex + delta;
    if (target < 0 || target >= fields.length) return;
    [fields[fieldIndex], fields[target]] = [fields[target], fields[fieldIndex]];
    updateQuestion(questionIndex, { fields });
  }

  function moveRepeatFieldOption(questionIndex: number, fieldIndex: number, optionIndex: number, delta: -1 | 1) {
    const options = [...(data.questions[questionIndex]?.fields?.[fieldIndex]?.options ?? [])];
    const target = optionIndex + delta;
    if (target < 0 || target >= options.length) return;
    [options[optionIndex], options[target]] = [options[target], options[optionIndex]];
    updateRepeatField(questionIndex, fieldIndex, { options });
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
      <div className="row wrap"><label className="field" style={{ flex: "2 1 220px", margin: 0 }}><span>Questionnaire language</span><input id="builder-language" className="input" maxLength={64} value={data.language ?? "en-AU"} placeholder="en-AU" onChange={(event) => setData((current) => ({ ...current, language: event.target.value }))} /><span className="hint">Use a BCP 47 tag such as en-AU, vi, es, or ar. This describes the authored questionnaire; it does not translate it.</span></label><label className="field" style={{ flex: "1 1 180px", margin: 0 }}><span>Text direction</span><select id="builder-direction" className="select" value={data.direction ?? "ltr"} onChange={(event) => setData((current) => ({ ...current, direction: event.target.value as NonNullable<BasicQuestionnaire["direction"]> }))}><option value="ltr">Left to right</option><option value="rtl">Right to left</option><option value="auto">Automatic</option></select><span className="hint">Set this to match the questionnaire content. The respondent shell language is separate.</span></label></div>
      <div className="field"><label htmlFor="builder-presentation">Respondent flow</label><select id="builder-presentation" className="select" value={data.presentation ?? "all"} onChange={(event) => changePresentation(event.target.value as NonNullable<BasicQuestionnaire["presentation"]>)}><option value="all">All questions on one page</option><option value="guided">One section at a time</option><option value="guided-question">One question at a time</option></select><span className="hint">Respondents can switch back to all questions. Their answers are retained when routing hides a question.</span></div>
      <div className="stack"><div className="row wrap" style={{ justifyContent: "space-between" }}><div><strong>Sections <span className="muted">(optional)</span></strong><div className="hint">Organize questions for the respondent contents list.</div></div><button className="btn sm" type="button" disabled={(data.sections?.length ?? 0) >= 30} onClick={addSection}>Add section</button></div>
        {(data.sections ?? []).map((section, index) => <fieldset className="card" key={section.id} style={{ padding: 16, margin: 0 }}><legend className="sr-only">Section {index + 1}</legend>
          <div className="row wrap" style={{ justifyContent: "space-between" }}><strong>Section {index + 1}</strong><div className="row"><button className="btn sm" type="button" aria-label={`Move section ${index + 1} up`} disabled={index === 0} onClick={() => moveSection(index, -1)}>Move up</button><button className="btn sm" type="button" aria-label={`Move section ${index + 1} down`} disabled={index === (data.sections?.length ?? 0) - 1} onClick={() => moveSection(index, 1)}>Move down</button><button className="btn danger sm" type="button" onClick={() => removeSection(index)}>Remove</button></div></div>
          <div className="field"><label htmlFor={`builder-section-id-${index}`}>Stable section ID</label><input id={`builder-section-id-${index}`} className="input mono" maxLength={64} pattern="[a-z0-9][a-z0-9_-]{0,63}" value={section.id} onChange={(event) => updateSection(index, { id: event.target.value })} /></div>
          <div className="field"><label htmlFor={`builder-section-title-${index}`}>Section title</label><input id={`builder-section-title-${index}`} className="input" maxLength={120} value={section.title} onChange={(event) => updateSection(index, { title: event.target.value })} /></div>
          <div className="field"><label htmlFor={`builder-section-description-${index}`}>Section description <span className="muted">(optional)</span></label><textarea id={`builder-section-description-${index}`} className="textarea" rows={2} maxLength={1000} value={section.description} onChange={(event) => updateSection(index, { description: event.target.value })} /></div>
        </fieldset>)}
      </div>
      {data.presentation === "all" && <fieldset className="card" style={{ padding: 16, margin: 0 }}>
        <legend>Question order groups <span className="muted">(optional)</span></legend>
        <p className="hint">Opt in to a respondent-specific order for a contiguous run of independent questions. Choose at least two adjacent standard questions in the same section. Routed questions and questions used by routing cannot be grouped. Group membership stays attached when you rename question IDs; grouped questions cannot be moved individually.</p>
        {(data.questionOrderGroups ?? []).map((group) => <div className="row wrap" key={group.id} style={{ justifyContent: "space-between" }}><span><strong>{group.id}</strong>: {group.questionIds.map((id) => data.questions.find((question) => question.id === id)?.label || id).join(" → ")}</span><button className="btn danger sm" type="button" aria-label={`Remove question order group ${group.id}`} onClick={() => removeQuestionOrderGroup(group.id)}>Remove group</button></div>)}
        <div className="stack" style={{ marginTop: 12 }}><strong>Add an order group</strong>{data.questions.map((question, index) => {
          const reason = questionOrderGroupEligibility(question);
          const selected = selectedOrderQuestionIds.includes(question.id);
          return <label className="choice" key={question.id}><input type="checkbox" aria-label={`Include question ${index + 1} in an order group`} disabled={Boolean(reason)} checked={selected} onChange={(event) => setSelectedOrderQuestionIds((current) => event.target.checked ? [...current, question.id] : current.filter((id) => id !== question.id))} /><span>Question {index + 1}: {question.label || question.id}{reason ? <span className="muted"> — {reason}</span> : ""}</span></label>;
        })}<button className="btn sm" type="button" disabled={Boolean(selectedOrderGroupProblem())} onClick={addQuestionOrderGroup}>Add selected questions as a group</button><span className="hint" role="status">{selectedOrderGroupProblem() || "The selected questions are ready to group."}</span></div>
      </fieldset>}
      {data.questions.some((question) => question.when) && <span className="hint">Keep routed questions after the questions they depend on. Move controls disable positions that would break a route.</span>}
      {data.questions.map((question, index) => <fieldset className="card" key={`${index}-${question.id}`} style={{ padding: 16, margin: 0 }}>
        <legend className="sr-only">Question {index + 1}</legend>
        <div className="row wrap" style={{ justifyContent: "space-between", marginBottom: 12 }}><strong>Question {index + 1}</strong><div className="row"><button className="btn sm" type="button" aria-label={`Move question ${index + 1} up`} disabled={!canMoveQuestion(index, -1)} onClick={() => move(index, -1)}>Move up</button><button className="btn sm" type="button" aria-label={`Move question ${index + 1} down`} disabled={!canMoveQuestion(index, 1)} onClick={() => move(index, 1)}>Move down</button><button className="btn danger sm" type="button" aria-label={`Remove question ${index + 1}`} disabled={data.questions.length === 1} onClick={() => removeQuestion(index)}>Remove</button></div></div>
        <div className="field"><label htmlFor={`builder-id-${index}`}>Stable question ID</label><input id={`builder-id-${index}`} className="input mono" maxLength={64} pattern="[a-z0-9][a-z0-9_-]{0,63}" value={question.id} onChange={(event) => updateQuestion(index, { id: event.target.value })} /><span className="hint">Lowercase letters, numbers, hyphens and underscores. Keep this ID if you revise the file after collecting answers.</span></div>
        <div className="field"><label htmlFor={`builder-type-${index}`}>Answer type</label><select id={`builder-type-${index}`} className="select" value={question.type} onChange={(event) => changeType(index, event.target.value as BasicQuestionType)}>{questionTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></div>
        {(data.sections?.length ?? 0) > 0 && <div className="field"><label htmlFor={`builder-section-${index}`}>Section</label><select id={`builder-section-${index}`} className="select" disabled={(data.questionOrderGroups ?? []).some((group) => group.questionIds.includes(question.id))} value={question.section ?? ""} onChange={(event) => updateQuestion(index, { section: event.target.value || undefined })}><option value="">No section</option>{data.sections?.map((section) => <option key={section.id} value={section.id}>{section.title || section.id}</option>)}</select>{(data.questionOrderGroups ?? []).some((group) => group.questionIds.includes(question.id)) && <span className="hint">Remove this question from its order group before changing its section.</span>}</div>}
        {index > 0 && !(data.questionOrderGroups ?? []).some((group) => group.questionIds.includes(question.id)) && <div className="stack" style={{ marginTop: 12 }}><strong>Show this question when</strong>
          {(["all", "any"] as const).filter((group) => (question.when?.[group]?.length ?? 0) > 0).map((group) => <fieldset className="card" key={group} style={{ padding: 14, margin: 0 }}>
            <legend>{group === "all" ? "All of these rules" : "At least one of these rules"}</legend>
            {routeConditions(question, group).map((condition, conditionIndex) => <div className="stack" key={`${conditionIndex}-${condition.question}`}><div className="row wrap" style={{ alignItems: "flex-end" }}><label className="field" style={{ flex: "1 1 220px", margin: 0 }}><span>Earlier question</span><select id={`builder-route-source-${index}-${group}-${conditionIndex}`} className="select" value={condition.question} onChange={(event) => selectRouteSource(index, group, event.target.value, conditionIndex)}>{data.questions.slice(0, index).filter((source) => !(data.questionOrderGroups ?? []).some((orderGroup) => orderGroup.questionIds.includes(source.id))).map((source) => <option key={source.id} value={source.id}>{source.label || source.id}</option>)}</select></label>{renderRouteCondition(index, group, conditionIndex)}<button className="btn danger sm" type="button" aria-label={`Remove ${group === "all" ? "all-match" : "any-match"} routing rule ${conditionIndex + 1} from question ${index + 1}`} onClick={() => setRouteCondition(index, group, conditionIndex)}>Remove rule</button></div></div>)}
            <button className="btn sm" type="button" aria-label={`Add ${group === "all" ? "all-match" : "any-match"} routing rule to question ${index + 1}`} disabled={routeConditions(question, group).length >= 20} onClick={() => addRouteCondition(index, group)}>Add routing rule</button>
          </fieldset>)}
          {(["all", "any"] as const).filter((group) => (question.when?.[group]?.length ?? 0) === 0).map((group) => <button className="btn sm" key={group} type="button" aria-label={`Add ${group === "all" ? "all-match" : "any-match"} rule group to question ${index + 1}`} onClick={() => addRouteCondition(index, group)}>Add {group === "all" ? "all-match" : "any-match"} rule group</button>)}
          <span className="hint">Only earlier questions can control this question. Every all-match rule and at least one any-match rule must match when both groups are present. Inactive answers remain saved.</span>
        </div>}
        <div className="field"><label htmlFor={`builder-label-${index}`}>Question text</label><input id={`builder-label-${index}`} className="input" maxLength={300} value={question.label} onChange={(event) => updateQuestion(index, { label: event.target.value })} /></div>
        <div className="field"><label htmlFor={`builder-help-${index}`}>Help text <span className="muted">(optional)</span></label><textarea id={`builder-help-${index}`} className="textarea" rows={2} maxLength={1000} value={question.help} onChange={(event) => updateQuestion(index, { help: event.target.value })} /></div>
        <label className="choice"><input type="checkbox" checked={question.required} onChange={(event) => updateQuestion(index, { required: event.target.checked })} /><span>Required to submit</span></label>
        {question.type !== "repeat" && <label className="choice"><input id={`builder-note-${index}`} type="checkbox" checked={question.note ?? false} onChange={(event) => updateQuestion(index, { note: event.target.checked })} /><span>Allow an optional comment</span></label>}
        {["single", "multi", "select", "rank"].includes(question.type) && <div className="stack" style={{ marginTop: 14 }}><strong>{question.type === "rank" ? "Ranked options" : "Answer choices"}</strong>{(question.options ?? []).map((option, optionIndex) => <div className="row wrap" key={optionIndex}>
          <label className="field" style={{ flex: "1 1 130px", margin: 0 }}><span>Stored value</span><input aria-label={`Choice ${optionIndex + 1} stored value for question ${index + 1}`} className="input mono" maxLength={64} value={option.value} onChange={(event) => updateQuestion(index, { options: (question.options ?? []).map((item, i) => i === optionIndex ? { ...item, value: event.target.value } : item) })} /></label>
          <label className="field" style={{ flex: "2 1 180px", margin: 0 }}><span>Displayed label</span><input aria-label={`Choice ${optionIndex + 1} displayed label for question ${index + 1}`} className="input" maxLength={300} value={option.label} onChange={(event) => updateQuestion(index, { options: (question.options ?? []).map((item, i) => i === optionIndex ? { ...item, label: event.target.value } : item) })} /></label>
          <button className="btn sm" type="button" aria-label={`Move choice ${optionIndex + 1} up in question ${index + 1}`} disabled={optionIndex === 0} onClick={() => moveOption(index, optionIndex, -1)}>Move up</button><button className="btn sm" type="button" aria-label={`Move choice ${optionIndex + 1} down in question ${index + 1}`} disabled={optionIndex === (question.options?.length ?? 0) - 1} onClick={() => moveOption(index, optionIndex, 1)}>Move down</button>
          <button className="btn danger sm" type="button" disabled={(question.options?.length ?? 0) <= 2} aria-label={`Remove choice ${optionIndex + 1} from question ${index + 1}`} onClick={() => updateQuestion(index, { options: (question.options ?? []).filter((_, i) => i !== optionIndex) })}>Remove choice</button>
        </div>)}<button className="btn sm" type="button" disabled={(question.options?.length ?? 0) >= (question.type === "rank" ? 8 : 50)} onClick={() => addOption(index)}>Add choice</button>{question.type === "rank" && <span className="hint">Respondents order all 2–8 options; KQA stores the full permutation without scoring responses.</span>}</div>}
        {["single", "multi", "select"].includes(question.type) && <div className="stack" style={{ marginTop: 14 }}>
          <label className="choice"><input id={`builder-randomize-options-${index}`} type="checkbox" checked={question.randomizeOptions ?? false} onChange={(event) => updateQuestion(index, { randomizeOptions: event.target.checked })} /><span>Randomize choice order for each respondent</span></label>
          <span className="hint">Use for choices without a natural order. Keep ordered categories in their authored order.</span>
          {question.randomizeOptions && <div className="stack" style={{ paddingLeft: 18 }}><strong>Keep choices in their authored positions <span className="muted">(optional)</span></strong>{(question.options ?? []).map((option, optionIndex) => {
            const fixed = (question.fixedOptionValues ?? []).includes(option.value);
            const fixedLimit = Math.max(0, (question.options?.length ?? 0) - 2);
            return <label className="choice" key={option.value}><input id={`builder-fixed-option-${index}-${optionIndex}`} type="checkbox" checked={fixed} disabled={!fixed && (question.fixedOptionValues?.length ?? 0) >= fixedLimit} onChange={(event) => updateQuestion(index, { fixedOptionValues: event.target.checked ? [...(question.fixedOptionValues ?? []), option.value] : (question.fixedOptionValues ?? []).filter((value) => value !== option.value) })} /><span>{option.label || option.value}</span></label>;
          })}<span className="hint">At least two choices must remain available to rotate.</span></div>}
          {question.type === "multi" && <div className="stack" style={{ paddingLeft: 18 }}><strong>Choices respondents must select alone <span className="muted">(optional)</span></strong>{(question.options ?? []).map((option, optionIndex) => <label className="choice" key={option.value}><input id={`builder-exclusive-option-${index}-${optionIndex}`} type="checkbox" checked={(question.exclusiveOptions ?? []).includes(option.value)} disabled={(question.minSelections ?? 0) > 1} onChange={(event) => updateQuestion(index, { exclusiveOptions: event.target.checked ? [...(question.exclusiveOptions ?? []), option.value] : (question.exclusiveOptions ?? []).filter((value) => value !== option.value) })} /><span>{option.label || option.value}</span></label>)}<span className="hint">Use for choices such as “None of these” or “Prefer not to say.” Exclusive choices need to be valid on their own, so a minimum above 1 is not allowed.</span></div>}
        </div>}
        {question.type === "multi" && <div className="row wrap" style={{ marginTop: 14 }}>
          <label className="field" style={{ flex: "1 1 150px", margin: 0 }}><span>Minimum selections <span className="muted">(optional)</span></span><input id={`builder-min-selections-${index}`} className="input" type="number" min={1} max={(question.exclusiveOptions?.length ?? 0) > 0 ? 1 : question.options?.length} value={question.minSelections ?? ""} onChange={(event) => { const value = event.target.value === "" ? undefined : Number(event.target.value); if ((question.exclusiveOptions?.length ?? 0) > 0 && (value ?? 0) > 1) { setError("Exclusive choices must be valid on their own, so minimum selections cannot be above 1. Remove the exclusive choice first to set a higher minimum."); return; } updateQuestion(index, { minSelections: value }); }} /></label>
          <label className="field" style={{ flex: "1 1 150px", margin: 0 }}><span>Maximum selections <span className="muted">(optional)</span></span><input id={`builder-max-selections-${index}`} className="input" type="number" min={1} max={question.options?.length} value={question.maxSelections ?? ""} onChange={(event) => updateQuestion(index, { maxSelections: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
          <span className="hint">A minimum applies to a non-empty answer. An optional blank answer remains a skip.</span>
        </div>}
        {["text", "longtext"].includes(question.type) && <div className="field"><label htmlFor={`builder-max-length-${index}`}>Maximum characters</label><input id={`builder-max-length-${index}`} className="input" type="number" min={1} max={question.type === "text" ? 500 : 20000} value={question.maxLength ?? (question.type === "text" ? 500 : 20000)} onChange={(event) => updateQuestion(index, { maxLength: event.target.value === "" ? undefined : Number(event.target.value) })} /><span className="hint">The respondent can correct an over-limit draft before saving or submitting.</span></div>}
        {["number", "scale"].includes(question.type) && <div className="row wrap" style={{ marginTop: 14 }}>
          <label className="field" style={{ flex: "1 1 130px", margin: 0 }}><span>Minimum</span><input className="input" type="number" value={question.min ?? (question.type === "scale" ? 1 : "")} onChange={(event) => updateQuestion(index, { min: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
          <label className="field" style={{ flex: "1 1 130px", margin: 0 }}><span>Maximum</span><input className="input" type="number" value={question.max ?? (question.type === "scale" ? 5 : "")} onChange={(event) => updateQuestion(index, { max: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
        </div>}
        {question.type === "number" && <div className="field"><label htmlFor={`builder-step-${index}`}>Increment <span className="muted">(optional)</span></label><input id={`builder-step-${index}`} className="input" type="number" min="0.0000001" step="any" value={question.step ?? ""} onChange={(event) => updateQuestion(index, { step: event.target.value === "" ? undefined : Number(event.target.value) })} /><span className="hint">Leave blank to accept any numeric precision.</span></div>}
        {question.type === "repeat" && <div className="stack" style={{ marginTop: 14 }}>
          <div className="row wrap">
            <label className="field" style={{ flex: "1 1 130px", margin: 0 }}><span>Row label</span><input className="input" maxLength={80} value={question.itemLabel ?? "item"} onChange={(event) => updateQuestion(index, { itemLabel: event.target.value })} /></label>
            <label className="field" style={{ flex: "1 1 130px", margin: 0 }}><span>Maximum rows</span><input className="input" type="number" min={1} max={20} value={question.maxRows ?? 5} onChange={(event) => updateQuestion(index, { maxRows: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
            <label className="field" style={{ flex: "1 1 130px", margin: 0 }}><span>Minimum complete rows <span className="muted">{question.required ? "(required means at least one)" : "(optional)"}</span></span><input className="input" type="number" min={question.required ? 1 : 0} max={question.maxRows ?? 5} value={question.minRows ?? (question.required ? 1 : "")} onChange={(event) => updateQuestion(index, { minRows: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
          </div>
          <span className="hint">Use for a small finite set of similar records. Keep the cap low and explain what one row represents and what to do at the limit.</span>
          {(question.fields ?? []).map((field, fieldIndex) => <fieldset className="card" key={field.id} style={{ padding: 14, margin: 0 }}><legend className="sr-only">Record field {fieldIndex + 1}</legend>
            <div className="row wrap" style={{ justifyContent: "space-between" }}><strong>Record field {fieldIndex + 1}</strong><div className="row"><button className="btn sm" type="button" aria-label={`Move record field ${fieldIndex + 1} up in question ${index + 1}`} disabled={fieldIndex === 0} onClick={() => moveRepeatField(index, fieldIndex, -1)}>Move up</button><button className="btn sm" type="button" aria-label={`Move record field ${fieldIndex + 1} down in question ${index + 1}`} disabled={fieldIndex === (question.fields?.length ?? 0) - 1} onClick={() => moveRepeatField(index, fieldIndex, 1)}>Move down</button><button className="btn danger sm" type="button" disabled={(question.fields?.length ?? 0) <= 1} onClick={() => updateQuestion(index, { fields: question.fields?.filter((_, item) => item !== fieldIndex) })}>Remove field</button></div></div>
            <div className="row wrap"><label className="field" style={{ flex: "1 1 130px", margin: 0 }}><span>Stable field ID</span><input className="input mono" maxLength={64} pattern="[a-z0-9][a-z0-9_-]{0,63}" value={field.id} onChange={(event) => updateRepeatField(index, fieldIndex, { id: event.target.value })} /></label>
              <label className="field" style={{ flex: "1 1 150px", margin: 0 }}><span>Type</span><select aria-label={`Record field ${fieldIndex + 1} type`} className="select" value={field.type} onChange={(event) => updateRepeatField(index, fieldIndex, { type: event.target.value as BasicRepeatField["type"] })}>{["single", "select", "text", "longtext", "number", "scale", "date"].map((type) => <option key={type} value={type}>{type === "single" ? "Single choice" : type === "select" ? "Dropdown" : type === "longtext" ? "Paragraph" : type[0].toUpperCase() + type.slice(1)}</option>)}</select></label></div>
            <label className="field"><span>Field label</span><input className="input" maxLength={300} value={field.label} onChange={(event) => updateRepeatField(index, fieldIndex, { label: event.target.value })} /></label>
            <div className="field"><label>Field help <span className="muted">(optional)</span></label><input className="input" maxLength={1000} value={field.help ?? ""} onChange={(event) => updateRepeatField(index, fieldIndex, { help: event.target.value || undefined })} /></div>
            <label className="choice"><input type="checkbox" checked={field.required ?? false} onChange={(event) => updateRepeatField(index, fieldIndex, { required: event.target.checked })} /><span>Required in each row</span></label>
            {["single", "select"].includes(field.type) && <div className="stack" style={{ marginTop: 10 }}><strong>Field choices</strong>{(field.options ?? []).map((option, optionIndex) => <div className="row wrap" key={optionIndex}><input aria-label={`Record field ${fieldIndex + 1} choice ${optionIndex + 1} value`} className="input mono" value={option.value} onChange={(event) => updateRepeatField(index, fieldIndex, { options: field.options?.map((optionItem, itemIndex) => itemIndex === optionIndex ? { ...optionItem, value: event.target.value } : optionItem) })} /><input aria-label={`Record field ${fieldIndex + 1} choice ${optionIndex + 1} label`} className="input" value={option.label} onChange={(event) => updateRepeatField(index, fieldIndex, { options: field.options?.map((optionItem, itemIndex) => itemIndex === optionIndex ? { ...optionItem, label: event.target.value } : optionItem) })} /><button className="btn sm" type="button" aria-label={`Move choice ${optionIndex + 1} up in record field ${fieldIndex + 1} of question ${index + 1}`} disabled={optionIndex === 0} onClick={() => moveRepeatFieldOption(index, fieldIndex, optionIndex, -1)}>Move up</button><button className="btn sm" type="button" aria-label={`Move choice ${optionIndex + 1} down in record field ${fieldIndex + 1} of question ${index + 1}`} disabled={optionIndex === (field.options?.length ?? 0) - 1} onClick={() => moveRepeatFieldOption(index, fieldIndex, optionIndex, 1)}>Move down</button><button className="btn danger sm" type="button" disabled={(field.options?.length ?? 0) <= 2} onClick={() => updateRepeatField(index, fieldIndex, { options: field.options?.filter((_, itemIndex) => itemIndex !== optionIndex) })}>Remove choice</button></div>)}<button className="btn sm" type="button" disabled={(field.options?.length ?? 0) >= 50} onClick={() => updateRepeatField(index, fieldIndex, { options: [...(field.options ?? []), { value: `option-${(field.options?.length ?? 0) + 1}`, label: `Option ${(field.options?.length ?? 0) + 1}` }] })}>Add field choice</button></div>}
            {["number", "scale"].includes(field.type) && <div className="row wrap"><label className="field" style={{ flex: "1 1 130px", margin: 0 }}><span>Minimum</span><input className="input" type="number" value={field.min ?? (field.type === "scale" ? 1 : "")} onChange={(event) => updateRepeatField(index, fieldIndex, { min: event.target.value === "" ? undefined : Number(event.target.value) })} /></label><label className="field" style={{ flex: "1 1 130px", margin: 0 }}><span>Maximum</span><input className="input" type="number" value={field.max ?? (field.type === "scale" ? 5 : "")} onChange={(event) => updateRepeatField(index, fieldIndex, { max: event.target.value === "" ? undefined : Number(event.target.value) })} /></label></div>}
            {field.type === "number" && <label className="field"><span>Increment <span className="muted">(optional)</span></span><input className="input" type="number" min="0.0000001" step="any" value={field.step ?? ""} onChange={(event) => updateRepeatField(index, fieldIndex, { step: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>}
            {["text", "longtext"].includes(field.type) && <label className="field"><span>Maximum characters</span><input className="input" type="number" min={1} max={field.type === "text" ? 500 : 20000} value={field.maxLength ?? (field.type === "text" ? 500 : 20000)} onChange={(event) => updateRepeatField(index, fieldIndex, { maxLength: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>}
          </fieldset>)}
          <button className="btn sm" type="button" disabled={(question.fields?.length ?? 0) >= 12} onClick={() => addRepeatField(index)}>Add record field</button>
        </div>}
      </fieldset>)}
      <div className="row wrap"><button className="btn" type="button" disabled={data.questions.length >= 500} onClick={addQuestion}>Add question</button><span className="muted">{data.questions.length} question{data.questions.length === 1 ? "" : "s"}</span></div>
      <p className="hint">This composer covers common question types, repeatable records, sections, routing comparisons, and input limits. For custom controls or an existing interview version, use the HTML upload workflow so those details stay explicit and reviewable.</p>
      {(built.error || error) && <pre className="callout err" role="alert" style={{ whiteSpace: "pre-wrap" }}>{error || built.error}</pre>}
      <div className="row wrap" style={{ justifyContent: "flex-end" }}><button className="btn" type="button" disabled={!built.html} onClick={download}>Download HTML</button><button className="btn primary" type="button" disabled={!built.html} onClick={() => { setError(""); onUse(built.html); }}>Use questionnaire</button></div>
    </div>
  </section>;
}
