/**
 * Deterministic, model-ready interpretation guidance for agents using KQA analytics.
 * KQA itself does not run an LLM or apply these instructions to a report.
 */
export const ANALYTICS_GUIDANCE_VERSION = "kqa-analytics/7" as const;

const PRINCIPLES = [
  {
    id: "frame-the-decision",
    title: "Start with the business question",
    guidance:
      "Restate the decision to inform, the outcome of interest, the relevant audience, and the time or interview scope. Map each part to a question and a participant cohort before interpreting results. If the interview does not measure the requested outcome, say so and offer the nearest measured proxy without presenting it as equivalent.",
  },
  {
    id: "name-the-cohort",
    title: "Make participant scope explicit",
    guidance:
      "State whether the result includes all people in the interview, only submitted people, or a caller-selected participant status subset. KQA's default analyze_answers scope includes invited, in-progress, and submitted people; submittedOnly or statuses can restrict the cohort. Set compareStatuses to compare selected statuses from one participant scan and one shared asOf; each question page is still a separate live read. scope.participantCount and statusCohorts[].participantCount count everyone in their selected status groups. respondentCount is a compatibility alias for these counts; do not describe invited people with no answers as respondents. Per-question cohortCount is everyone in the selected status group, not a count of people eligible to see that question. KQA does not record whether conditional or routed questions were displayed or applicable. State each group's participant count, cohortCount, valid-answer n, and denominator; do not infer item eligibility. Use subgroup comparisons only when the subgroup is directly represented in available data and disclose its size.",
  },
  {
    id: "show-missingness",
    title: "Treat missing and unmapped answers as information",
    guidance:
      "Report cohortCount, answeredCount, noAnswerCount, noteOnlyCount, and unmappedResponseCount when available. noAnswerCount means there is no non-empty stored value; it may include people who were not shown a conditional or routed item because KQA does not track item-level display or eligibility. Legacy eligibleCount and missingCount fields are aliases retained for compatibility, not item-level eligibility or missingness measures. Distinguish an unanswered item from an answer that no longer maps to the current version's choices or range. Do not silently impute, recode, or treat no answer as a negative response. Explain that nonresponse can bias interpretation when who answered differs from who did not; KQA summaries do not estimate or correct that bias.",
  },
  {
    id: "match-measure-to-statistic",
    title: "Respect the question's measurement type",
    guidance:
      "For single-choice and dropdown questions, show category counts or valid-response shares. For ordered scales, prefer the full distribution and optionally report the median; do not report a mean for a scale or assume equal spacing between its labels. For number questions, describe n, range, Q1, median, Q3, and mean; Q1 and Q3 use type-7 sample quantiles with linear interpolation. Note skew or extreme values only when supported by these summaries. Dates and free text are not summarized by the current aggregate tool; use the relevant review or export workflow only when the task requires it.",
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
      "Use a category bar chart for single-choice and dropdown responses; sort unordered categories by a stated rule and preserve the natural order of scales. For multi-select answers, plot each option's share of valid respondents and state that shares can sum above 100%. Use a 100% stacked bar only for comparable groups with a shared denominator. For number questions, a box plot may use the returned minimum, Q1, median, Q3, and maximum; label whiskers as minimum-to-maximum, not outlier fences. KQA does not return raw number values or bins, so do not invent a histogram. KQA does not aggregate date or text values. Prefer a table or short written summary when exact counts, many categories, small cohorts, or caveats matter more than a visual pattern. Label the measure, cohort, valid n, denominator, survey version, and asOf; do not use a truncated bar axis that exaggerates differences.",
  },
  {
    id: "generate-auditable-visuals",
    title: "Make generated visuals accessible and traceable",
    guidance:
      "When asked to create an interactive chart or report, use only values returned by KQA tools and preserve their labels and denominators. Show the interview, survey version, cohort, and asOf beside the visual. Make controls keyboard-operable, do not rely on color or hover alone, and provide an equivalent data table or text description. Accompany the code with a concise finding, the evidence behind it, and a material limitation or follow-up question. If the requested chart needs data KQA did not return, explain the gap instead of inventing values.",
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
  "Are cohortCount, answeredCount, noAnswerCount, unmappedResponseCount, and valid-answer denominators distinguished, with KQA's item-eligibility limit stated?",
  "Do side-by-side status groups come from one scan, share an asOf, and show each group's denominator?",
  "Are scale distributions treated as ordered categories, number summaries described as numeric, and multi-select shares labeled per respondent?",
  "Does the interpretation avoid unsupported population, significance, or causal claims and identify material uncertainty?",
  "Does the chart fit the comparison, show clear labels and denominators, and avoid visual distortion?",
  "Does generated chart code use only returned values, identify interview/version/cohort/asOf, and provide keyboard access plus an equivalent table or text description?",
  "Are separate question pages described as separate live reads rather than one consistent snapshot?",
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
    name: "R stats, Sample Quantiles",
    url: "https://stat.ethz.ch/R-manual/R-devel/library/stats/html/quantile.html",
    supports: "Hyndman-Fan type-7 sample quantiles with linear interpolation, the default method in R.",
  },
  {
    name: "Office for National Statistics, Choosing a chart type",
    url: "https://service-manual.ons.gov.uk/data-visualisation/chart-types/choosing-a-chart-type",
    supports: "Matching chart forms to the message and data structure.",
  },
  {
    name: "W3C WAI, Complex Images",
    url: "https://www.w3.org/WAI/tutorials/images/complex/",
    supports: "Providing long descriptions or data-table equivalents for complex charts and graphs.",
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
      "Use KQA analytics to describe the selected interview cohort and build accessible, traceable visuals, with explicit scope, denominators, missingness, and limitations. KQA has no built-in LLM; this versioned package is deterministic guidance for an integrated agent, not an automated analysis or certification.",
    productConstraints: [
      "KQA's analyze_answers output is current-version descriptive data; it returns no raw text, names, notes, private links, score, significance test, or causal estimate.",
      "The default cohort includes invited, in-progress, and submitted people. submittedOnly restricts the cohort to submitted people; statuses can select any non-empty subset of those statuses.",
      "KQA does not enforce a minimum cohort-size threshold; singleton counts and percentages may be returned. Integrated agents should state small-n limitations and follow the host's disclosure rules.",
      "Answered values that do not fit the current version remain counted as answered and are reported as unmapped; they are excluded from valid distributions and numeric summaries.",
      "Multi-select percentages use valid responding people as the denominator, and percentages can sum above 100%.",
      "Scale questions provide a distribution and median, not a mean. Number summaries respect current question bounds and provide n, minimum, Q1, median, Q3, mean, and maximum; quartiles use Hyndman-Fan type 7.",
      "Date and text answers have no aggregate summary in analyze_answers. For a requested distribution, use only an available aggregate or ask before inspecting individual answers with get_answers.",
      "Each analyze_answers page is a separate live read with its own asOf; changes can occur between pages, so KQA does not provide a consistent multi-page snapshot.",
      "When compareStatuses is true, status groups on one page share a participant scan and asOf; this live read does not use a frozen database snapshot.",
    ],
    principles: PRINCIPLES.map((principle) => ({ ...principle })),
    reviewChecklist: [...REVIEW_CHECKLIST],
    sources: SOURCES.map((source) => ({ ...source })),
  };
}
