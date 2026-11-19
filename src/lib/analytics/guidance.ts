/**
 * Deterministic, model-ready interpretation guidance for agents using KQA analytics.
 * KQA itself does not run an LLM or apply these instructions to a report.
 */
export const ANALYTICS_GUIDANCE_VERSION = "kqa-analytics/16" as const;

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
      "State whether the result includes all people in the interview, only submitted people, or a caller-selected participant status subset. KQA's default analyze_answers scope includes invited, in-progress, and submitted people; submittedOnly or statuses can restrict the cohort. Set compareStatuses to compare selected statuses from one participant scan and one shared asOf. For paginated tool results, pass analysisRunId back as runId with interviewId and offset/limit so every page uses the same completed aggregate output and asOf; the initial participant scan is live and is not a database snapshot. scope.participantCount and statusCohorts[].participantCount count everyone in their selected status groups. respondentCount is a compatibility alias for these counts; do not describe invited people with no answers as respondents. Per-question cohortCount is everyone in the selected status group; eligibleCount and inactiveCount are inferred from the current routing rules and saved answers. KQA does not retain historical display telemetry. State each group's participant count, eligible/inactive counts, valid-answer n, and denominator; do not present inferred eligibility as proof an item was displayed. Use subgroup comparisons only when the subgroup is directly represented in available data and disclose its size.",
  },
  {
    id: "explore-answer-segments",
    title: "Use closed answers for exploratory segments",
    guidance:
      "Use analyze_answers segmentBy with questionIds to compare up to 20 outcome questions across a single-choice, dropdown, checkbox, or scale answer in one participant scan. questionId remains available for one outcome. Keep the segment question out of the outcome summary. Show each group's participant count and each outcome's eligible count and valid-answer denominator; percentages use valid eligible answers in that group. Outcome summaries separate inactive people under the current rules. Checkbox segments overlap because one person may select several options, so do not add those group counts or shares together. Use crossTabWith with segmentBy to compare two closed categorical answers in a bounded matrix of up to 20 groups per question and 400 cells. Each cell counts distinct people in that answer pair; row percentages use that row's participant count. Inactive-by-current-rules is a separate dimension group. If either dimension is a checkbox, a person can appear in several rows or columns, so cells can overlap and percentages can sum above 100%. Cross-tabs include all valid answer pairs, including zero-count cells, plus observed no-answer, inactive, and unmapped groups; they return status counts and singleton cell signals. Eligibility is inferred from current rules and saved answers, not historical display. KQA returns singleton and zero-count groups without suppression. disclosureRisk.singletonSegment flags a one-person group or cell; disclosureRisk.singletonStatusGroups lists one-person status groups. These are singleton signals only, not a complete identifiability assessment; an empty signal is not an anonymity guarantee, and downstream disclosure rules still apply.",
  },
  {
    id: "show-missingness",
    title: "Treat missing and unmapped answers as information",
    guidance:
      "Report cohortCount, eligibleCount, inactiveCount, answeredCount, noAnswerCount, noteOnlyCount, and unmappedResponseCount when available. Eligibility and inactivity are inferred from the current manifest's routing rules and saved answers; they are not historical records that an item was displayed. noAnswerCount counts eligible people without a non-empty stored answer; inactiveCount is separate. The legacy missingCount mirrors noAnswerCount. Distinguish an unanswered item from an answer that no longer maps to the current version's choices or range. Do not silently impute, recode, or treat no answer as a negative response. Explain that nonresponse can bias interpretation when who answered differs from who did not; KQA summaries do not estimate or correct that bias.",
  },
  {
    id: "match-measure-to-statistic",
    title: "Respect the question's measurement type",
    guidance:
      "For single-choice and dropdown questions, show category counts or valid-response shares. For ordered scales, prefer the full distribution and optionally report the observed middle category when n is odd or both central observed categories when n is even; never average category codes or report a mean, and do not assume equal spacing between labels. QuestionSummary.scaleMedian retains the lower central category for compatibility; scaleMedianRange gives the exact central category or pair. For number questions, describe n, range, Q1, median, Q3, and mean. Number quantiles are exact Hyndman-Fan type 7 through n=256; larger summaries use mergeable, bounded DDSketch estimates and return the method, 2% relative-value accuracy setting, bin limit, collapse flag, mapped-range flag, and error-guarantee status in numeric.quantiles. Relative-value error is not rank error. If binsCollapsed or mappingRangeExceeded is true, no relative error bound applies. Minimum, maximum, and mean use all valid numeric answers. Never imply quantile uncertainty is zero for DDSketch results. Dates and free text are not summarized by the current aggregate tool; use the relevant review or export workflow only when the task requires it.",
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
      "Use aggregate results for analysis. Do not include names, email addresses, private links, raw free-text answers, or identifying combinations in charts or summaries. Question summaries include disclosureRisk singleton signals for cohort, answered, no-answer, note-only, unmapped, valid-answer denominator, one-person distribution values, and one-response numeric summaries. Use these to identify visible counts of one in ordinary and status-comparison results; segmented results also include segment-level singleton signals. KQA returns every count and value without minimum-size suppression. These signals do not cover all attribute combinations or outside knowledge; before sharing, follow the host's disclosure rules and assess whether details could identify someone. KQA's aggregate output is not a guarantee that a downstream report is anonymous.",
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
  "Are cohortCount, eligibleCount, inactiveCount, answeredCount, noAnswerCount, unmappedResponseCount, and valid-answer denominators distinguished, with inferred eligibility clearly separated from historical display?",
  "Do side-by-side status groups come from one scan, share an asOf, and show each group's denominator?",
  "Are scale distributions treated as ordered categories, number summaries described as numeric, and multi-select shares labeled per respondent?",
  "Does the interpretation avoid unsupported population, significance, or causal claims and identify material uncertainty?",
  "Does the chart fit the comparison, show clear labels and denominators, and avoid visual distortion?",
  "Does generated chart code use only returned values, identify interview/version/cohort/asOf, and provide keyboard access plus an equivalent table or text description?",
  "Do paginated MCP results reuse analysisRunId as runId, and is the initial live scan distinguished from the repeatable completed aggregate pages?",
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
    name: "DataDog, DDSketch",
    url: "https://github.com/DataDog/sketches-js",
    supports: "Mergeable relative-value-error quantiles; KQA uses a collapsing store and reports when that invalidates the relative error guarantee.",
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
      "QuestionSummary.disclosureRisk flags singleton cohort, answer, no-answer, note-only, unmapped, valid-denominator, distribution-value, and numeric-summary counts. singletonDistributionValues lists the current-version values with a count of one. This is a detectable-signal set, not an identifiability assessment or anonymity guarantee.",
      "analyze_answers segmentBy groups up to 20 selected outcome questions by one closed categorical current-version answer in one shared participant scan; checkbox groups can overlap, and answer-group counts include singleton and zero-count options. questionIds selects the outcomes; questionId remains available for one outcome.",
      "analyze_answers can use segmentBy with crossTabWith to return a count-only cross-tab between two closed categorical current-version questions. Each dimension has at most 20 groups and the matrix at most 400 cells. Cells count distinct people per answer pair, include zero-count answer pairs, row denominators, status counts, and singleton signals; checkbox dimensions overlap. No minimum group threshold applies.",
      "All selected outcomes in one segmented analysis share the same status scope, participant scan, and asOf. Segment disclosureRisk metadata flags singleton segments and, for status comparisons, singleton status groups. Question-level disclosureRisk metadata accompanies each ordinary, status, and segmented summary. Neither metadata shape assesses combinations of attributes or guarantees anonymity.",
      "Answered values that do not fit the current version remain counted as answered and are reported as unmapped; they are excluded from valid distributions and numeric summaries.",
      "Multi-select percentages use valid responding people as the denominator, and percentages can sum above 100%.",
      "Full-order rank answers are ordered arrays, not category selections. Do not include rank questions in distributions, segmentation, or cross-tabs, and do not calculate a rank score. Preserve the complete order when reviewing individual answers or exports.",
      "Scale questions provide a distribution and the observed middle category or central pair, not an average of ordinal codes. QuestionSummary.scaleMedianRange contains the exact central observed category or pair; scaleMedian is its lower value retained for compatibility. No mean is calculated for scales. Number summaries respect current question bounds and provide n, minimum, Q1, median, Q3, mean, and maximum. numeric.quantiles reports exact Hyndman-Fan type 7 through n=256, or approximate DDSketch quartiles after that; it states relative-value accuracy, bin limit, whether bins collapsed, whether values exceeded the mapped range, and whether the relative error guarantee applies. This memory threshold changes only quantile precision, never which cohort counts or numeric summaries are returned.",
      "Date and text answers have no aggregate summary in analyze_answers. For a requested distribution, use only an available aggregate or ask before inspecting individual answers with get_answers.",
      "For paginated analyze_answers results, reuse analysisRunId as runId with interviewId and offset/limit. Completed aggregate pages share one asOf and remain available for up to one hour; the initial participant scan is live and is not isolated by a database snapshot. Runs are tenant-bound and contain aggregate output only. If an analysisRunId is not returned, the result was not paginated and no run needs to be continued.",
      "When compareStatuses is true, status groups on one page share a participant scan and asOf; this live read does not use a frozen database snapshot.",
      "Segmented outcome summaries share the selected status scope and participant scan. No-answer and unmapped segments are named explicitly; outcome denominators are per segment, and aggregation does not guarantee anonymity.",
    ],
    principles: PRINCIPLES.map((principle) => ({ ...principle })),
    reviewChecklist: [...REVIEW_CHECKLIST],
    sources: SOURCES.map((source) => ({ ...source })),
  };
}
