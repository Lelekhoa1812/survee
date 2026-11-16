export type DesignSurface = "all" | "questionnaire" | "host" | "analytics";

const PRINCIPLES = [
  { id: "task-first", surfaces: ["all", "questionnaire", "host", "analytics"], title: "Make the task obvious", guidance: "Lead with the user's current task, the next useful action, and the current state. Keep labels concrete, use plain language, and explain consequences before destructive or irreversible actions." },
  { id: "theme-fit", surfaces: ["all", "questionnaire", "host"], title: "Fit the intended theme", guidance: "Use the supplied brand, audience, and tone as constraints. Define a small set of semantic color, type, spacing, and shape tokens, then reuse them. Keep contrast and focus indicators legible when the theme changes; do not encode meaning by color alone." },
  { id: "brief-specific-visuals", surfaces: ["all", "questionnaire", "host", "analytics"], title: "Make visual choices specific to the brief", guidance: "Choose palette, type, layout, and motion for this product, audience, and task. Treat familiar product patterns as options rather than defaults; keep a distinctive motif only when it supports the brief and remove decoration that adds no meaning. The user's direction takes precedence over this heuristic." },
  { id: "respondent-control", surfaces: ["all", "questionnaire"], title: "Keep respondents oriented and in control", guidance: "Use clear section titles, concise progress, save state, and submission consequences. Make optional and required questions distinct. Preserve stable question and option ids across versions, and disclose when a change can affect stored answers." },
  { id: "question-clarity", surfaces: ["all", "questionnaire"], title: "Ask clear, neutral questions", guidance: "Ask one thing at a time in familiar, audience-appropriate language. Avoid leading assumptions, ambiguous terms, double negatives, and questions that combine multiple ideas. Give a specific reference period when asking about time-bound behavior, and make instructions match the answer the respondent is expected to provide." },
  { id: "response-options", surfaces: ["all", "questionnaire"], title: "Make response options fit the question", guidance: "For closed questions, make options distinct and cover reasonable answers. Use balanced scale labels with a consistent direction; include a neutral point, 'not applicable', 'not sure', 'prefer not to answer', or 'other' only when it fits the construct. Keep option order intentional and stable when comparing versions." },
  { id: "pretest", surfaces: ["all", "questionnaire"], title: "Pretest with intended respondents", guidance: "For new or high-impact questionnaires, ask people like the intended respondents to explain what they think a question means and how they chose an answer. Revise confusing items before fielding. This content review requires human or agent judgment and respondent research; the static KQA checker cannot perform or certify it." },
  { id: "task-usability", surfaces: ["all", "questionnaire", "host", "analytics"], title: "Test complete tasks with representative users", guidance: "For new or materially changed flows, observe people who represent the intended users completing realistic end-to-end tasks. Note task completion, hesitation, errors, recovery, and content misunderstandings; report who was represented, which tasks and success criteria were used, what was observed, and the limitations. If sessions were not run, say usability is untested. Keep task-based usability research distinct from question-item cognitive pretesting and WCAG evaluation." },
  { id: "accessible-interaction", surfaces: ["all", "questionnaire", "host", "analytics"], title: "Make every interaction operable", guidance: "Prefer native semantic controls with programmatic labels and keyboard behavior. Custom radio groups must follow the WAI-ARIA APG keyboard pattern. Keep focused controls fully visible, including around fixed or sticky UI (WCAG 2.4.11), and provide a non-drag alternative for dragging interactions (WCAG 2.5.7). Make errors identify the affected field and give a clear correction; announce status and errors to assistive technology. Meet WCAG 2.2 AA, including target size: pointer targets should be at least 24 × 24 CSS px or meet a WCAG exception such as sufficient spacing. Test keyboard and assistive technology behavior rather than treating static markup checks as proof." },
  { id: "responsive", surfaces: ["all", "questionnaire", "host", "analytics"], title: "Design for narrow screens and long content", guidance: "Reflow without two-dimensional page scrolling at 320 CSS pixels where WCAG requires it; KQA questionnaires must also work from 360 px and should be checked at 390 px. Test long labels, errors, empty states, tables, and zoom, not only the happy-path screenshot." },
  { id: "motion", surfaces: ["all", "questionnaire", "host"], title: "Use motion to clarify change", guidance: "Animate only to communicate state or spatial continuity. Keep transitions brief and interruptible; honor prefers-reduced-motion and ensure the interface remains understandable with motion removed." },
  { id: "honest-analytics", surfaces: ["all", "analytics"], title: "Show how every number was made", guidance: "Name the survey version, time window, respondent status filter, status-cohort denominator, no-answer count, and valid-answer count. KQA does not track whether conditional questions were shown, so do not present cohort counts as item eligibility or no-answer counts as item-level missingness. Use distributions for ordinal scales, describe multi-select percentages as respondent shares, and separate observed facts from interpretation. Do not imply causality, significance, or a score." },
  { id: "privacy", surfaces: ["all", "questionnaire", "host", "analytics"], title: "Minimize exposure of answer data", guidance: "Aggregate by default, reveal person-level answers only for an explicit review task, and avoid putting private respondent links or raw answers into analytics, logs, or unrelated exports." },
];

const ACCESSIBILITY_EVALUATION_METHOD = {
  name: "WCAG Evaluation Methodology (WCAG-EM) 2.0",
  source: "https://www.w3.org/TR/wcag-em-2/",
  status: "W3C Group Note published 23 July 2026 with informative process guidance; it is not a normative WCAG success criterion or a claim of conformance.",
  steps: [
    "Define the product, routes, themes, technologies, user groups, and conformance target in scope.",
    "Explore the product's essential functionality and identify representative views, states, and complete task paths, including important branches and errors.",
    "Select and record a representative sample; include different content types, interaction patterns, and process branches rather than relying on a single screenshot.",
    "Evaluate each selected sample against the chosen WCAG criteria using appropriate automated and manual checks. Run npm run a11y:audit at desktop, 320, 360, and 390 CSS px for public routes. For the host console and respondent flow, use --authenticated with a disposable local account, optional interview/respondent fixture ids, and --report to save a privacy-minimized JSON record; manually inspect interactive states and record each method's evidence and limits.",
    "For every selected sample, create one QA evidence row with its route, state/theme, viewport and input method, criterion, method/tool, observed result, evidence reference, and limitations. Mark checks that were not run as untested instead of omitting them; never include respondent personal data in evidence references.",
    "Report the scope, sample, methods, findings, and unresolved gaps. Do not claim full-product conformance from a static scan, checklist, or unrepresentative sample.",
  ],
} as const;

const TASK_BASED_USABILITY_METHOD = {
  name: "Task-based usability sessions",
  status: "Qualitative research evidence about observed task performance; it is not a WCAG conformance result, a representative population estimate, or proof that every user can complete the flow.",
  when: "Plan sessions for new or materially changed flows, high-impact tasks, or recurring support and completion problems. Include end-to-end questionnaire completion for respondent journeys and realistic setup, review, or interpretation tasks for host and analytics journeys.",
  steps: [
    "Define the intended user roles and recruit participants who reflect the relevant experience, access needs, devices, and context. State important groups that are not represented.",
    "Write realistic, neutral tasks and observable success criteria before the session. Do not coach participants through the intended interface path.",
    "Observe task completion, hesitation, errors, workarounds, recovery, and misunderstandings. Ask about expectations after the task rather than leading participants toward a preferred answer.",
    "Report the participant context, tasks, success criteria, observed outcomes, critical friction, changes made, and remaining uncertainty. Keep task results separate from item-level cognitive pretesting and WCAG evaluation.",
    "If sessions were not run, label usability as untested and explain the reason. A prototype walkthrough, team review, automated scan, or analytics metric is not a substitute for observation with representative users.",
  ],
} as const;

const REVIEW_CHECKLIST_ITEMS: { surfaces: Exclude<DesignSurface, "all">[]; text: string }[] = [
  { surfaces: ["questionnaire", "host", "analytics"], text: "Check the primary task, next action, and outcome are clear without relying on color or animation." },
  { surfaces: ["questionnaire", "host", "analytics"], text: "Check semantic labels, keyboard-only operation, focus visibility, validation messages, and save/submission announcements." },
  { surfaces: ["questionnaire", "host", "analytics"], text: "Check focus is not obscured by fixed or sticky UI, dragging has a non-drag alternative, and errors identify the field and explain a correction." },
  { surfaces: ["questionnaire"], text: "Prefer native radio controls; if a custom radio group is necessary, verify the WAI-ARIA APG arrow-key and Tab behavior." },
  { surfaces: ["questionnaire", "host", "analytics"], text: "Check pointer targets are at least 24 × 24 CSS px or meet a WCAG 2.2 SC 2.5.8 exception such as sufficient spacing." },
  { surfaces: ["questionnaire", "host", "analytics"], text: "Check WCAG 2.2 AA contrast and reflow at 320 CSS px; also check questionnaire layouts at KQA's 360/390 px widths." },
  { surfaces: ["questionnaire", "host", "analytics"], text: "Check empty, loading, saving, success, error, submitted, long-content, dark-theme, and reduced-motion states." },
  { surfaces: ["questionnaire"], text: "Review question wording for one clear idea, neutral language, specific reference periods, and respondent-appropriate terms; this is a content judgment, not a static checker result." },
  { surfaces: ["questionnaire"], text: "For closed questions, check options are distinct and cover reasonable answers, scales read consistently, and option ordering is intentional." },
  { surfaces: ["questionnaire"], text: "Pretest new or high-impact questions with people like the intended respondents when feasible; record uncertainty that remains." },
  { surfaces: ["questionnaire", "host", "analytics"], text: "For new or materially changed flows, observe representative users completing realistic end-to-end tasks. Record task success, hesitation, errors, recovery, content misunderstandings, participant context, and limitations; mark usability untested when sessions were not run. This is distinct from item pretesting and WCAG evaluation." },
  { surfaces: ["questionnaire"], text: "Check question and option ids remain stable, answer-changing edits are explained, and no required state is hidden." },
  { surfaces: ["analytics"], text: "For analytics, verify survey version, participant scope, cohort n, no-answer count, valid n, and multi-select denominator; state that KQA does not track item-level display eligibility." },
  { surfaces: ["questionnaire", "host", "analytics"], text: "Treat automated/static findings as evidence for specific checks only; they do not establish full WCAG conformance or visual quality." },
  { surfaces: ["host"], text: "Run npm run a11y:audit on representative public routes at desktop and 320 CSS px. Use --authenticated with a disposable local account to include protected host flows, and --report to retain a commit-scoped JSON summary; include interview and respondent fixtures when available. Review every violation and incomplete result, then perform manual keyboard, focus, content, and assistive-technology checks." },
  { surfaces: ["questionnaire", "host", "analytics"], text: "For a conformance evaluation, define the scope, explore essential task paths, select and record representative views, states, and branches, evaluate each against the target criteria, and report findings and remaining gaps." },
  { surfaces: ["questionnaire", "host", "analytics"], text: "Keep one QA evidence row per selected sample with route, state/theme, viewport/input method, criterion, method/tool, observed result, evidence reference, and limitations; mark unrun checks as untested and omit respondent personal data." },
];

export const DESIGN_REVIEW_CHECKLIST = REVIEW_CHECKLIST_ITEMS.map(({ text }) => text);

const SOURCES = [
  { name: "WCAG 2.2 Quick Reference", url: "https://www.w3.org/WAI/WCAG22/quickref/", role: "Normative accessibility success criteria; target WCAG 2.2 AA." },
  { name: "WCAG Evaluation Methodology (WCAG-EM) 2.0", url: "https://www.w3.org/TR/wcag-em-2/", role: "W3C Group Note published 23 July 2026 with informative, technology-agnostic process guidance for defining scope, exploring a product, selecting representative samples, evaluating them, and reporting findings; it is not a normative conformance criterion." },
  { name: "W3C WAI: Evaluating Web Accessibility", url: "https://www.w3.org/WAI/test-evaluate/", role: "Explains that no evaluation tool alone can determine whether a site meets accessibility standards; automated findings need manual evaluation and representative sampling." },
  { name: "axe-core", url: "https://github.com/dequelabs/axe-core", role: "Open-source browser rules engine for automated WCAG checks; its violations and incomplete results are evidence for specific rules, not a complete accessibility verdict." },
  { name: "WCAG 2.2 SC 2.5.8: Target Size (Minimum)", url: "https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html", role: "Explains the Level AA 24 × 24 CSS pixel target-size criterion and its exceptions." },
  { name: "WAI-ARIA Authoring Practices Guide: Tabs", url: "https://www.w3.org/WAI/ARIA/apg/patterns/tabs/", role: "Implementation guidance for accessible tab interactions; not a conformance standard." },
  { name: "WAI-ARIA Authoring Practices Guide: Radio Group", url: "https://www.w3.org/WAI/ARIA/apg/patterns/radio/", role: "Keyboard interaction guidance for custom radio groups; native radio controls remain preferable." },
  { name: "WAI Forms Tutorial: User Notifications", url: "https://www.w3.org/WAI/tutorials/forms/notifications/", role: "Guidance for concise, understandable form errors and status messages." },
  { name: "GitHub Primer Product Design", url: "https://primer.style/product/", role: "First-party design-system reference for product principles, components, and tokens." },
  { name: "GOV.UK Design System", url: "https://design-system.service.gov.uk/", role: "Research-informed service design and content patterns; localize UK-specific conventions." },
  { name: "GOV.UK Service Manual: User research", url: "https://www.gov.uk/service-manual/user-research", role: "Methods for observing representative users doing realistic tasks; research evidence complements automated checks." },
  { name: "GOV.UK Service Manual: Plan user research", url: "https://www.gov.uk/service-manual/user-research/plan-user-research-for-your-service", role: "Plan research activities for each development phase and update the plan as evidence about users and the service changes." },
  { name: "U.S. Web Design System: Design principles", url: "https://designsystem.digital.gov/design-principles/", role: "Official federal design principles call for starting from real user needs and regularly testing assumptions and products with real people." },
  { name: "Pew Research Center: Writing Survey Questions", url: "https://www.pewresearch.org/writing-survey-questions/", role: "Survey question wording, response-option design, order effects, and pretesting; apply the research principles to KQA's supported formats." },
  { name: "AAPOR: Best Practices for Survey Research", url: "https://aapor.org/standards-and-ethics/best-practices/", role: "Professional survey research and reporting practices; use with context and do not treat the static checker as a methods review." },
  { name: "Anthropic frontend-design skill", url: "https://raw.githubusercontent.com/anthropics/skills/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/frontend-design/SKILL.md", revision: "41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f", reviewedAt: "2026-11-16", contentSha256: "d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3", role: "Optional subjective design-process inspiration reviewed at this immutable Git revision; not a standard and not an authority over the user's brief, WCAG, or KQA policy." },
];

const DESIGN_PLAN = {
  purpose: "A repeatable brief-to-build-to-review contract for the connected agent. Treat the user's stated visual direction and constraints as authoritative; ask only when a missing choice would materially change the result.",
  inputs: ["surface", "audience", "primary user task", "brand/theme references", "user-supplied CSS custom properties or token JSON when available", "content and data density", "technical and accessibility constraints"],
  steps: [
    "Restate the audience, primary task, and user-provided theme constraints; identify assumptions that materially affect the design.",
    "When the user supplies brand CSS custom properties or token JSON, call extract_design_profile with the intended surface; review its source scopes, provenance, ambiguity, contrast candidates, and safe overlay before integrating. Never fetch an arbitrary stylesheet URL or execute supplied CSS.",
    "Choose a visual direction from the product's subject matter and supplied references. Explain why it fits; do not apply a generic style recipe by default. Taste guidance is heuristic and must yield to the user's brief.",
    "Before building, check whether the main choices could fit almost any unrelated product. Revise generic defaults unless the brief specifically supports them, and explain why the selected visual motif belongs here.",
    "Map semantic color, typography, spacing, shape, and elevation roles to the applicable visual profile. Reuse existing tokens where available; document any deliberate extension rather than scattering literal values.",
    "Describe information hierarchy, layout at narrow and wide widths, key components, and loading, empty, error, success, and disabled states relevant to the task.",
    "Use motion only when it clarifies a user action or state change; preserve the same meaning with prefers-reduced-motion enabled.",
    "For a new or materially changed flow, plan task-based usability sessions with representative users. Define realistic tasks and success criteria, then observe completion, hesitation, errors, recovery, and misunderstandings. If sessions are not feasible, identify usability as untested.",
    "Build, then critique against the brief and review checklist. Inspect rendered narrow and wide layouts, keyboard operation, focus, contrast, and relevant non-happy-path states. When sessions are run, report the represented users, tasks, success criteria, observations, and limits; do not imply a session occurred when it did not.",
    "For a WCAG conformance evaluation, follow the accessibility evaluation methodology below: define scope, explore essential functionality, select representative views and states, evaluate the sample against the target criteria, and document the findings and limits in the QA evidence matrix.",
  ],
  accessibilityEvaluationMethodology: ACCESSIBILITY_EVALUATION_METHOD,
  taskBasedUsabilityMethodology: TASK_BASED_USABILITY_METHOD,
  output: {
    fields: ["briefSummary", "visualDirection", "tokenMapping", "designProfileProposalAndReview", "layoutAndHierarchy", "componentAndStatePlan", "responsivePlan", "motionPlan", "usabilityEvaluationScope", "representativeUserProfiles", "realisticTasksAndSuccessCriteria", "observedUsabilityFindings", "usabilityLimitationsOrUntestedReason", "accessibilityEvaluationScope", "representativeSamplesAndStates", "reviewEvidence", "openQuestions"],
    reviewEvidenceMatrix: {
      required: true,
      columns: [
        { name: "surfaceRoute", required: true, description: "Product surface and route or questionnaire step reviewed." },
        { name: "stateTheme", required: true, description: "Interaction state and theme, such as validation error in dark mode." },
        { name: "viewportInputMethod", required: true, description: "Viewport size plus input method, such as 320 CSS px with keyboard." },
        { name: "criterion", required: true, description: "Specific WCAG criterion or product review question." },
        { name: "methodTool", required: true, description: "Manual procedure, automated tool, assistive technology, or research method." },
        { name: "observedResult", required: true, description: "Observed outcome, or an explicit statement that the check was not run." },
        { name: "evidenceReference", required: true, description: "Test/report artifact, screenshot reference, or commit-scoped record; use none when untested." },
        { name: "limitationUntestedReason", required: true, description: "Known limitation or reason the check was not run." },
      ],
      starterSamples: [
        "Questionnaire validation error at a required field",
        "Host or analytics loading and success states",
        "Keyboard focus and overlay or dialog behavior",
        "Reduced-motion preference enabled",
        "Dark theme with representative controls and text",
        "Reflow at 320 CSS px with long content",
        "Questionnaire layout at 360 and 390 CSS px",
      ],
      instructions: [
        "Create one row for every selected sample and criterion; include applicable starter samples or explain why they are out of scope.",
        "Distinguish the method performed from its observed result. An automated pass is evidence only for the checks that tool covers.",
        "Do not omit untested samples: set the result to untested, cite no evidence, and explain why.",
        "Use artifact references without respondent names, answers, private links, credentials, or other personal data.",
      ],
    },
    evidenceRule: "State concrete checks and their results in the required reviewEvidenceMatrix. A proposed plan, static check, or screenshot alone does not prove full WCAG conformance, usability, or visual quality. Mark user research as untested unless sessions with relevant participants were actually observed.",
  },
  guardrails: [
    "WCAG 2.2 AA is the accessibility target; subjective taste heuristics never override it or the user's explicit direction.",
    "Do not claim full-product WCAG conformance based only on a static scan, checklist, screenshot, or unrepresentative sample; record the evaluated scope, sample, criteria, findings, and unresolved gaps in the QA evidence matrix.",
    "Do not add motion, gradients, cards, display type, or decorative labels merely because a design heuristic suggests them; use only when justified by this brief and task.",
    "Treat common dashboard and landing-page treatments as choices to justify, not a default kit. Let the user's supplied direction override any subjective anti-pattern heuristic.",
    "Do not invent brand facts or claim user research occurred when it did not.",
  ],
  surfaceInstructions: {
    host: "Use the host visual profile below as the source of truth for existing tokens. Add or change tokens centrally and check both light and dark themes.",
    questionnaire: "The questionnaire is rendered in a sandboxed iframe. The host page's CSS variables are not inherited. Follow docs/FORMAT.md and the starter questionnaire kit; define or override tokens inside the questionnaire document and keep styles within supported frame constraints.",
    analytics: "Prioritize comparison, provenance, denominator clarity, and accessible chart alternatives. Treat color as supplemental encoding and retain readable labels or tables. Do not suppress small groups by default; preserve singleton disclosure signals and state limits.",
  },
} as const;

const HOST_VISUAL_PROFILE = {
  source: "src/app/globals.css",
  themeModes: ["light", "prefers-color-scheme: dark"],
  direction: "When no custom brand direction is supplied, use a calm, precise, private, operational tone: deep navy for framework, restrained teal for action/progress, neutral surfaces for dense work, and clear text hierarchy. This is a product-specific default heuristic; preserve the user's brief.",
  composition: [
    "Give each page one clear task. Place title, context, and status before the controls that act on them.",
    "Use lists or tables for record management and reserve charts for comparisons. Avoid nested-card framing when spacing and headings can establish hierarchy.",
    "Keep destructive actions visually distinct, secondary until needed, and confirmed; communicate status with text or icons as well as color.",
  ],
  surfacePatterns: {
    host: "For desktop host pages, the shared frame uses a centered 1160 px content width. Put the page purpose, current state, and primary action in the first scan path; keep respondent identity, progress, and delivery status legible in dense lists.",
    analytics: "Put cohort and status scope near the result. Show participant count, valid denominator, and no-answer count with each interpretation; pair charts with readable labels or a table. Do not suppress small groups by default; preserve singleton disclosure signals and state limits.",
  },
  tokens: {
    canvas: ["--bg"], surfaces: ["--surface", "--surface-2", "--surface-3"],
    text: ["--ink", "--ink-2", "--muted"], borders: ["--line", "--line-2", "--field"],
    brand: ["--brand", "--brand-2", "--brand-ink"],
    accent: ["--accent", "--accent-2", "--accent-soft", "--accent-ink"],
    status: ["--warn", "--warn-soft", "--warn-line", "--danger", "--danger-ink", "--danger-soft", "--danger-line", "--info", "--info-soft", "--info-line"],
    focus: ["--focus"], shape: ["--r", "--r-sm", "--r-xs"], elevation: ["--shadow-sm", "--shadow", "--shadow-lg"],
    typography: ["--sans", "--mono"],
  },
  coreThemeValues: {
    light: { "--bg": "#f3f5f8", "--surface": "#ffffff", "--ink": "#0e1b2a", "--muted": "#596b80", "--brand": "#0b2a42", "--accent": "#087960", "--focus": "#1f6feb", "--danger": "#b4261c", "--danger-ink": "#ffffff" },
    dark: { "--bg": "#0b1622", "--surface": "#101f2e", "--ink": "#e8eef5", "--muted": "#8fa1b3", "--brand": "#dbe7f3", "--accent": "#2bb58f", "--focus": "#6aa3ff", "--danger": "#f59a92", "--danger-ink": "#07121d" },
  },
  existingConventions: [
    "Semantic CSS variables have light values at :root and dark overrides under prefers-color-scheme: dark.",
    "Use --focus for visible keyboard focus, semantic status colors with text or icons, and the existing IBM Plex/system font stacks.",
    "No shared spacing scale is currently defined; choose a small consistent scale for new work and add tokens centrally if it needs reuse.",
  ],
  constraints: ["Token names describe roles; verify rendered contrast in both themes instead of assuming every color pairing passes.", "Do not hard-code replacements for established semantic tokens in individual components."],
} as const;

const QUESTIONNAIRE_VISUAL_PROFILE = {
  source: "docs/template/starter.kqa.html",
  direction: "A clear, respondent-first reading experience with a quiet contents rail on wide screens and one focused reading column. This starter direction is optional when the interview owner supplies a different theme.",
  tokens: ["--bg", "--surface", "--surface-2", "--ink", "--ink-2", "--muted", "--line", "--line-2", "--field", "--brand", "--accent", "--accent-soft", "--accent-ink", "--focus", "--danger", "--r", "--r-sm", "--shadow", "--sans", "--mono"],
  coreThemeValues: {
    light: { "--bg": "#f3f5f8", "--surface": "#ffffff", "--ink": "#0e1b2a", "--brand": "#0b2a42", "--accent": "#087960", "--focus": "#1f6feb", "--danger": "#b4261c" },
    dark: { "--bg": "#0b1622", "--surface": "#101f2e", "--ink": "#e8eef5", "--brand": "#07121d", "--accent": "#2bb58f", "--focus": "#6aa3ff", "--danger": "#f59a92" },
  },
  layoutConventions: [
    "The starter contents rail is 248 px and appears above 900 px; below that, use a single-column questionnaire layout.",
    "The starter reading column is at most 860 px, uses 16 px base text, and has 44 px scale targets.",
    "The starter supports prefers-reduced-motion by removing transitions and smooth scrolling.",
  ],
  constraints: [
    "The starter kit runs inside the questionnaire iframe; host CSS variables and fonts do not cross the sandbox boundary.",
    "Copy the starter style block unchanged when using the house design, then add scoped rules after it. Follow docs/FORMAT.md for supported browser and markup behavior.",
  ],
} as const;

export function getDesignGuidance(surface: DesignSurface = "all") {
  const surfaceInstructions: Record<string, string> = surface === "all"
    ? { ...DESIGN_PLAN.surfaceInstructions }
    : { [surface]: DESIGN_PLAN.surfaceInstructions[surface] };
  return {
    policyVersion: "kqa-design/15",
    surface,
    summary: "Design for clarity, respondent control, theme fit, accessible interaction, and honest interpretation. KQA does not embed an LLM; this package is deterministic guidance for the connected agent to apply and review.",
    productConstraints: [
      "Questionnaires are self-contained HTML in a sandboxed frame; follow docs/FORMAT.md for supported controls and browser limits.",
      "There is no in-app question builder and no scoring. Keep authoring as HTML plus the KQA checker, and keep analytics descriptive.",
      "Keep original question and option ids stable when revising a live interview; explain data-compatibility findings before applying a new version.",
    ],
    designPlan: { ...DESIGN_PLAN, surfaceInstructions },
    visualProfile: surface === "questionnaire"
      ? { questionnaire: QUESTIONNAIRE_VISUAL_PROFILE }
      : surface === "host"
        ? { host: HOST_VISUAL_PROFILE }
        : surface === "analytics"
          ? { host: HOST_VISUAL_PROFILE, analytics: DESIGN_PLAN.surfaceInstructions.analytics }
          : { host: HOST_VISUAL_PROFILE, questionnaire: QUESTIONNAIRE_VISUAL_PROFILE, analytics: DESIGN_PLAN.surfaceInstructions.analytics },
    principles: PRINCIPLES.filter((principle) => surface === "all" || principle.surfaces.includes(surface)),
    reviewChecklist: REVIEW_CHECKLIST_ITEMS
      .filter((item) => surface === "all" || item.surfaces.includes(surface))
      .map(({ text }) => text),
    sources: SOURCES,
  };
}
