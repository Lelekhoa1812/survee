/**
 * Deterministic, model-ready interpretation guidance for agents using KQA analytics.
 * KQA itself does not run an LLM or apply these instructions to a report.
 */
export const ANALYTICS_GUIDANCE_VERSION = "kqa-analytics/1" as const;

const PRINCIPLES = [
  {
    id: "frame-the-decision",
    title: "Start with the business question",
    guidance:
      "Restate the decision to inform, the outcome of interest, the relevant audience, and the time or interview scope. Map each part to a question and a respondent cohort before interpreting results. If the interview does not measure the requested outcome, say so and offer the nearest measured proxy without presenting it as equivalent.",
  },
  {
    id: "name-the-cohort",
    title: "Make respondent scope explicit",
    guidance:
      "State whether the result includes all people in the interview, only submitted people, or a caller-selected status subset. KQA's default analyze_answers scope includes invited, in-progress, and submitted people; submittedOnly or statuses can restrict the cohort. State question eligibility, valid-answer n, and the denominator for each result. Do not describe invited people as respondents when they supplied no answers. Use subgroup comparisons only when the subgroup is directly represented in available data and disclose its size.",
  },
  {
    id: "show-missingness",
    title: "Treat missing and unmapped answers as information",
    guidance:
      "Report eligible, answered, missing, note-only, and unmapped counts when available. Distinguish an unanswered item from an answer that no longer maps to the current version's choices or range. Do not silently impute, recode, or treat missing answers as a negative response. Explain that missingness can bias interpretation when who answered differs from who did not; KQA summaries do not estimate or correct that bias.",
  },
  {
    id: "match-measure-to-statistic",
    title: "Respect the question's measurement type",
    guidance:
      "For single-choice and dropdown questions, show category counts or valid-response shares. For ordered scales, prefer the full distribution and optionally report the median; do not report a mean for a scale or assume equal spacing between its labels. For number questions, describe the available n, range, mean, and median, and note skew or extreme values when visible. Dates and free text are not summarized by the current aggregate tool; use the relevant review or export workflow only when the task requires it.",
  },
  {
    id: "explain-multiselect",
    title: "Explain multi-select denominators",
    guidance:
      "For multi-select questions, percentages are the share of valid responding people selecting each option, not the share of all selections. A person may select multiple options, so option percentages can sum to more than 100%. State the valid-respondent denominator and keep missing or malformed answers outside that denominator as reported by KQA.",
  },
  {
    id: "describe-uncertainty",
    title: "Keep uncertainty and limitations visible",
    guidance:
      "Treat KQA's counts and summaries as descriptive of the selected interview cohort. They do not by themselves establish representativeness, sampling error, confidence intervals, statistical significance, or causal effects. Avoid words such as caused, drove, proves, significant, or representative unless a suitable design and analysis support them. Separate observed results from hypotheses and recommendations, and name the evidence each uses. Small or self-selected cohorts warrant especially cautious, concrete wording.",
  },
  {
    id: "choose-clear-chart",
    title: "Choose a chart that fits the comparison",
    guidance:
      "Use a sorted horizontal bar chart for a small set of unordered categories; preserve the natural order for ordered scales. Use a 100% stacked bar only to compare composition across clearly defined groups, with a shared denominator and legible labels. Use a line chart only when observations are ordered time points with comparable definitions and cohorts. Prefer a table or a short written summary when exact counts, many categories, small cohorts, or caveats matter more than a visual pattern. Label the measure, cohort, valid n, denominator, and time/version; do not use a truncated bar axis that exaggerates differences.",
  },
  {
    id: "protect-respondents",
    title: "Protect respondent privacy",
    guidance:
      "Use aggregate results for analysis. Do not include names, email addresses, private links, raw free-text answers, or identifying combinations in charts or summaries. Before sharing subgroup results, consider whether a person could be identified from a small count or from combining attributes; suppress or combine details when needed and follow the host's access and disclosure rules. KQA's aggregate output is not a guarantee that a downstream report is anonymous.",
  },
  {
    id: "resolve-ambiguity",
    title: "Resolve ambiguity before claiming an answer",
    guidance:
      "If the business term, comparison period, target audience, question meaning, cohort, or denominator has multiple plausible interpretations, state the ambiguity and either ask for clarification or show clearly labeled alternatives. Do not choose the interpretation that produces the strongest result. Preserve the questionnaire wording and version when paraphrasing a measure, and flag wording or option changes that limit comparisons across versions.",
  },
] as const;

const REVIEW_CHECKLIST = [
  "Does the answer name the decision, question, questionnaire version, respondent scope, and time period that were actually analyzed?",
  "Are eligible, answered, missing, unmapped, and valid-answer denominators distinguished where available?",
  "Are scale distributions treated as ordered categories, number summaries described as numeric, and multi-select shares labeled per respondent?",
  "Does the interpretation avoid unsupported population, significance, or causal claims and identify material uncertainty?",
  "Does the chart fit the comparison, show clear labels and denominators, and avoid visual distortion?",
  "Could a small subgroup, free-text detail, or combination of attributes identify someone?",
  "Are ambiguous or unmeasured business questions called out rather than answered by assumption?",
] as const;

const SOURCES = [
  {
    name: "AAPOR, Best Practices for Survey Research",
    url: "https://aapor.org/standards-and-ethics/best-practices/",
    supports: "Survey design, sampling, transparency, and careful interpretation of survey results.",
  },
  {
    name: "AAPOR, Disclosure Standards",
    url: "https://aapor.org/standards-and-ethics/disclosure-standards/",
    supports: "Disclosing enough methodology to support independent review of survey claims.",
  },
  {
    name: "Pew Research Center, Writing Survey Questions",
    url: "https://www.pewresearch.org/writing-survey-questions/",
    supports: "Question and response-option wording, ordered scales, and response-format effects.",
  },
  {
    name: "Pew Research Center, When Online Survey Respondents Only Select Some That Apply",
    url: "https://www.pewresearch.org/methods/2019/05/09/when-online-survey-respondents-only-select-some-that-apply/",
    supports: "Evidence and caveats about select-all-that-apply response formats.",
  },
  {
    name: "NIST/SEMATECH e-Handbook, Measures of Location",
    url: "https://www.itl.nist.gov/div898/handbook/eda/section3/eda351.htm",
    supports: "Interpretation of mean and median, including the effect of extreme values.",
  },
  {
    name: "Office for National Statistics, Choosing a chart type",
    url: "https://service-manual.ons.gov.uk/data-visualisation/chart-types/choosing-a-chart-type",
    supports: "Matching chart forms to the message and data structure.",
  },
  {
    name: "American Statistical Association, Ethical Guidelines for Statistical Practice",
    url: "https://www.amstat.org/your-career/ethical-guidelines-for-statistical-practice",
    supports: "Communicating data limitations, potential bias, and impacts on interpretation.",
  },
  {
    name: "American Statistical Association, Statement on Statistical Significance and P-Values",
    url: "https://www.amstat.org/docs/default-source/amstat-documents/p-valuestatement.pdf",
    supports: "Limits on what statistical significance and p-values can establish.",
  },
  {
    name: "Information Commissioner's Office, Introduction to anonymisation",
    url: "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/introduction-to-anonymisation/",
    supports: "Identifiability risk and the distinction between aggregate statistics and assured anonymity.",
  },
] as const;

/** Return a fresh JSON-serializable instruction package suitable for an MCP tool result. */
export function getAnalyticsGuidance() {
  return {
    policyVersion: ANALYTICS_GUIDANCE_VERSION,
    summary:
      "Use KQA analytics to describe the selected interview cohort, with explicit scope, denominators, missingness, and limitations. KQA has no built-in LLM; this versioned package is deterministic guidance for an integrated agent, not an automated analysis or certification.",
    productConstraints: [
      "KQA's analyze_answers output is current-version descriptive data; it returns no raw text, names, notes, private links, score, significance test, or causal estimate.",
      "The default cohort includes invited, in-progress, and submitted people. submittedOnly restricts the cohort to submitted people; statuses can select any non-empty subset of those statuses.",
      "Answered values that do not fit the current version remain counted as answered and are reported as unmapped; they are excluded from valid distributions and numeric summaries.",
      "Multi-select percentages use valid responding people as the denominator, and percentages can sum above 100%.",
      "Scale questions provide a distribution and median, not a mean. Number summaries respect the current question's bounds.",
    ],
    principles: PRINCIPLES.map((principle) => ({ ...principle })),
    reviewChecklist: [...REVIEW_CHECKLIST],
    sources: SOURCES.map((source) => ({ ...source })),
  };
}
