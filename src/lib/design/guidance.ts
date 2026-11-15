export type DesignSurface = "all" | "questionnaire" | "host" | "analytics";

const PRINCIPLES = [
  { id: "task-first", surfaces: ["all", "questionnaire", "host", "analytics"], title: "Make the task obvious", guidance: "Lead with the user's current task, the next useful action, and the current state. Keep labels concrete, use plain language, and explain consequences before destructive or irreversible actions." },
  { id: "theme-fit", surfaces: ["all", "questionnaire", "host"], title: "Fit the intended theme", guidance: "Use the supplied brand, audience, and tone as constraints. Define a small set of semantic color, type, spacing, and shape tokens, then reuse them. Keep contrast and focus indicators legible when the theme changes; do not encode meaning by color alone." },
  { id: "respondent-control", surfaces: ["all", "questionnaire"], title: "Keep respondents oriented and in control", guidance: "Use clear section titles, concise progress, save state, and submission consequences. Make optional and required questions distinct. Preserve stable question and option ids across versions, and disclose when a change can affect stored answers." },
  { id: "accessible-interaction", surfaces: ["all", "questionnaire", "host", "analytics"], title: "Make every interaction operable", guidance: "Use semantic controls with programmatic labels, keyboard operation, visible and unobscured focus, announced status and errors, and touch targets suited to the context. Meet WCAG 2.2 AA; test assistive technology and keyboard behavior rather than treating static markup checks as proof." },
  { id: "responsive", surfaces: ["all", "questionnaire", "host", "analytics"], title: "Design for narrow screens and long content", guidance: "Reflow without two-dimensional page scrolling at 320 CSS pixels where WCAG requires it; KQA questionnaires must also work from 360 px and should be checked at 390 px. Test long labels, errors, empty states, tables, and zoom, not only the happy-path screenshot." },
  { id: "motion", surfaces: ["all", "questionnaire", "host"], title: "Use motion to clarify change", guidance: "Animate only to communicate state or spatial continuity. Keep transitions brief and interruptible; honor prefers-reduced-motion and ensure the interface remains understandable with motion removed." },
  { id: "honest-analytics", surfaces: ["all", "analytics"], title: "Show how every number was made", guidance: "Name the survey version, time window, respondent status filter, eligible denominator, missing count, and valid-answer count. Use distributions for ordinal scales, describe multi-select percentages as respondent shares, and separate observed facts from interpretation. Do not imply causality, significance, or a score." },
  { id: "privacy", surfaces: ["all", "questionnaire", "host", "analytics"], title: "Minimize exposure of answer data", guidance: "Aggregate by default, reveal person-level answers only for an explicit review task, and avoid putting private respondent links or raw answers into analytics, logs, or unrelated exports." },
];

export const DESIGN_REVIEW_CHECKLIST = [
  "Check the primary task, next action, and outcome are clear without relying on color or animation.",
  "Check semantic labels, keyboard-only operation, focus visibility, validation messages, and save/submission announcements.",
  "Check WCAG 2.2 AA contrast and reflow; test at 320 CSS px and at KQA's 360/390 px questionnaire widths.",
  "Check empty, loading, saving, success, error, submitted, long-content, dark-theme, and reduced-motion states.",
  "Check question and option ids remain stable, answer-changing edits are explained, and no required state is hidden.",
  "For analytics, verify survey version, respondent scope, valid n, eligible n, missingness, and multi-select denominator in the rendered view.",
  "Treat automated/static findings as evidence for specific checks only; they do not establish full WCAG conformance or visual quality.",
];

const SOURCES = [
  { name: "WCAG 2.2 Quick Reference", url: "https://www.w3.org/WAI/WCAG22/quickref/", role: "Normative accessibility success criteria; target WCAG 2.2 AA." },
  { name: "WAI-ARIA Authoring Practices Guide: Tabs", url: "https://www.w3.org/WAI/ARIA/apg/patterns/tabs/", role: "Implementation guidance for accessible tab interactions; not a conformance standard." },
  { name: "GitHub Primer Product Design", url: "https://primer.style/product/", role: "First-party design-system reference for product principles, components, and tokens." },
  { name: "GOV.UK Design System", url: "https://design-system.service.gov.uk/", role: "Research-informed service design and content patterns; localize UK-specific conventions." },
  { name: "Anthropic frontend-design skill", url: "https://github.com/anthropics/skills/tree/main/skills/frontend-design", role: "Optional subjective design-process inspiration; not a standard and not an authority over KQA policy." },
];

export function getDesignGuidance(surface: DesignSurface = "all") {
  return {
    policyVersion: "kqa-design/1",
    surface,
    summary: "Design for clarity, respondent control, theme fit, accessible interaction, and honest interpretation. KQA does not embed an LLM; this package is deterministic guidance for the connected agent to apply and review.",
    productConstraints: [
      "Questionnaires are self-contained HTML in a sandboxed frame; follow docs/FORMAT.md for supported controls and browser limits.",
      "There is no in-app question builder and no scoring. Keep authoring as HTML plus the KQA checker, and keep analytics descriptive.",
      "Keep original question and option ids stable when revising a live interview; explain data-compatibility findings before applying a new version.",
    ],
    principles: PRINCIPLES.filter((principle) => surface === "all" || principle.surfaces.includes(surface)),
    reviewChecklist: DESIGN_REVIEW_CHECKLIST,
    sources: SOURCES,
  };
}
