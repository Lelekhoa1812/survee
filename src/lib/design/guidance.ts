export type DesignSurface = "all" | "questionnaire" | "host" | "analytics";

const PRINCIPLES = [
  { id: "task-first", surfaces: ["all", "questionnaire", "host", "analytics"], title: "Make the task obvious", guidance: "Lead with the user's current task, the next useful action, and the current state. Keep labels concrete, use plain language, and explain consequences before destructive or irreversible actions." },
  { id: "theme-fit", surfaces: ["all", "questionnaire", "host"], title: "Fit the intended theme", guidance: "Use the supplied brand, audience, and tone as constraints. Define a small set of semantic color, type, spacing, and shape tokens, then reuse them. Keep contrast and focus indicators legible when the theme changes; do not encode meaning by color alone." },
  { id: "respondent-control", surfaces: ["all", "questionnaire"], title: "Keep respondents oriented and in control", guidance: "Use clear section titles, concise progress, save state, and submission consequences. Make optional and required questions distinct. Preserve stable question and option ids across versions, and disclose when a change can affect stored answers." },
  { id: "question-clarity", surfaces: ["all", "questionnaire"], title: "Ask clear, neutral questions", guidance: "Ask one thing at a time in familiar, audience-appropriate language. Avoid leading assumptions, ambiguous terms, double negatives, and questions that combine multiple ideas. Give a specific reference period when asking about time-bound behavior, and make instructions match the answer the respondent is expected to provide." },
  { id: "response-options", surfaces: ["all", "questionnaire"], title: "Make response options fit the question", guidance: "For closed questions, make options distinct and cover reasonable answers. Use balanced scale labels with a consistent direction; include a neutral point, 'not applicable', 'not sure', 'prefer not to answer', or 'other' only when it fits the construct. Keep option order intentional and stable when comparing versions." },
  { id: "pretest", surfaces: ["all", "questionnaire"], title: "Pretest with intended respondents", guidance: "For new or high-impact questionnaires, ask people like the intended respondents to explain what they think a question means and how they chose an answer. Revise confusing items before fielding. This content review requires human or agent judgment and respondent research; the static KQA checker cannot perform or certify it." },
  { id: "accessible-interaction", surfaces: ["all", "questionnaire", "host", "analytics"], title: "Make every interaction operable", guidance: "Use semantic controls with programmatic labels, keyboard operation, visible and unobscured focus, announced status and errors. Meet WCAG 2.2 AA, including target size: pointer targets should be at least 24 × 24 CSS px or meet a WCAG exception such as sufficient spacing. Test assistive technology and keyboard behavior rather than treating static markup checks as proof." },
  { id: "responsive", surfaces: ["all", "questionnaire", "host", "analytics"], title: "Design for narrow screens and long content", guidance: "Reflow without two-dimensional page scrolling at 320 CSS pixels where WCAG requires it; KQA questionnaires must also work from 360 px and should be checked at 390 px. Test long labels, errors, empty states, tables, and zoom, not only the happy-path screenshot." },
  { id: "motion", surfaces: ["all", "questionnaire", "host"], title: "Use motion to clarify change", guidance: "Animate only to communicate state or spatial continuity. Keep transitions brief and interruptible; honor prefers-reduced-motion and ensure the interface remains understandable with motion removed." },
  { id: "honest-analytics", surfaces: ["all", "analytics"], title: "Show how every number was made", guidance: "Name the survey version, time window, respondent status filter, status-cohort denominator, no-answer count, and valid-answer count. KQA does not track whether conditional questions were shown, so do not present cohort counts as item eligibility or no-answer counts as item-level missingness. Use distributions for ordinal scales, describe multi-select percentages as respondent shares, and separate observed facts from interpretation. Do not imply causality, significance, or a score." },
  { id: "privacy", surfaces: ["all", "questionnaire", "host", "analytics"], title: "Minimize exposure of answer data", guidance: "Aggregate by default, reveal person-level answers only for an explicit review task, and avoid putting private respondent links or raw answers into analytics, logs, or unrelated exports." },
];

const REVIEW_CHECKLIST_ITEMS: { surfaces: Exclude<DesignSurface, "all">[]; text: string }[] = [
  { surfaces: ["questionnaire", "host", "analytics"], text: "Check the primary task, next action, and outcome are clear without relying on color or animation." },
  { surfaces: ["questionnaire", "host", "analytics"], text: "Check semantic labels, keyboard-only operation, focus visibility, validation messages, and save/submission announcements." },
  { surfaces: ["questionnaire", "host", "analytics"], text: "Check pointer targets are at least 24 × 24 CSS px or meet a WCAG 2.2 SC 2.5.8 exception such as sufficient spacing." },
  { surfaces: ["questionnaire", "host", "analytics"], text: "Check WCAG 2.2 AA contrast and reflow at 320 CSS px; also check questionnaire layouts at KQA's 360/390 px widths." },
  { surfaces: ["questionnaire", "host", "analytics"], text: "Check empty, loading, saving, success, error, submitted, long-content, dark-theme, and reduced-motion states." },
  { surfaces: ["questionnaire"], text: "Review question wording for one clear idea, neutral language, specific reference periods, and respondent-appropriate terms; this is a content judgment, not a static checker result." },
  { surfaces: ["questionnaire"], text: "For closed questions, check options are distinct and cover reasonable answers, scales read consistently, and option ordering is intentional." },
  { surfaces: ["questionnaire"], text: "Pretest new or high-impact questions with people like the intended respondents when feasible; record uncertainty that remains." },
  { surfaces: ["questionnaire"], text: "Check question and option ids remain stable, answer-changing edits are explained, and no required state is hidden." },
  { surfaces: ["analytics"], text: "For analytics, verify survey version, participant scope, cohort n, no-answer count, valid n, and multi-select denominator; state that KQA does not track item-level display eligibility." },
  { surfaces: ["questionnaire", "host", "analytics"], text: "Treat automated/static findings as evidence for specific checks only; they do not establish full WCAG conformance or visual quality." },
];

export const DESIGN_REVIEW_CHECKLIST = REVIEW_CHECKLIST_ITEMS.map(({ text }) => text);

const SOURCES = [
  { name: "WCAG 2.2 Quick Reference", url: "https://www.w3.org/WAI/WCAG22/quickref/", role: "Normative accessibility success criteria; target WCAG 2.2 AA." },
  { name: "WCAG 2.2 SC 2.5.8: Target Size (Minimum)", url: "https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html", role: "Explains the Level AA 24 × 24 CSS pixel target-size criterion and its exceptions." },
  { name: "WAI-ARIA Authoring Practices Guide: Tabs", url: "https://www.w3.org/WAI/ARIA/apg/patterns/tabs/", role: "Implementation guidance for accessible tab interactions; not a conformance standard." },
  { name: "GitHub Primer Product Design", url: "https://primer.style/product/", role: "First-party design-system reference for product principles, components, and tokens." },
  { name: "GOV.UK Design System", url: "https://design-system.service.gov.uk/", role: "Research-informed service design and content patterns; localize UK-specific conventions." },
  { name: "Pew Research Center: Writing Survey Questions", url: "https://www.pewresearch.org/writing-survey-questions/", role: "Survey question wording, response-option design, order effects, and pretesting; apply the research principles to KQA's supported formats." },
  { name: "AAPOR: Best Practices for Survey Research", url: "https://aapor.org/standards-and-ethics/best-practices/", role: "Professional survey research and reporting practices; use with context and do not treat the static checker as a methods review." },
  { name: "Anthropic frontend-design skill", url: "https://github.com/anthropics/skills/tree/main/skills/frontend-design", role: "Optional subjective design-process inspiration; not a standard and not an authority over KQA policy." },
];

export function getDesignGuidance(surface: DesignSurface = "all") {
  return {
    policyVersion: "kqa-design/4",
    surface,
    summary: "Design for clarity, respondent control, theme fit, accessible interaction, and honest interpretation. KQA does not embed an LLM; this package is deterministic guidance for the connected agent to apply and review.",
    productConstraints: [
      "Questionnaires are self-contained HTML in a sandboxed frame; follow docs/FORMAT.md for supported controls and browser limits.",
      "There is no in-app question builder and no scoring. Keep authoring as HTML plus the KQA checker, and keep analytics descriptive.",
      "Keep original question and option ids stable when revising a live interview; explain data-compatibility findings before applying a new version.",
    ],
    principles: PRINCIPLES.filter((principle) => surface === "all" || principle.surfaces.includes(surface)),
    reviewChecklist: REVIEW_CHECKLIST_ITEMS
      .filter((item) => surface === "all" || item.surfaces.includes(surface))
      .map(({ text }) => text),
    sources: SOURCES,
  };
}
