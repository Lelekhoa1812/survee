# Questionnaire authoring and review evaluation

survee separates product-format correctness from questionnaire content quality. A static checker can establish specific HTML, manifest, binding, sandbox, and routing constraints. It cannot establish that an item measures the intended construct, that respondents understand it, that a flow is usable, or that a questionnaire is suitable for a decision.

## Current benchmark

The public development corpus is [`questionnaire-authoring-cases.json`](questionnaire-authoring-cases.json), also available at `/api/docs/evals/questionnaire-authoring-cases.json`. It is a small, explicitly non-held-out review set of realistic briefs, flawed questions, and clean controls across customer, workplace, service, event, community, operational, and personal contexts. The labels are development annotations for improving the evaluation method; they are not a universal quality oracle or a claim that two independent survey-methods reviewers have adjudicated the cases.

Run a provider-neutral scorer by saving one review result per corpus case and running:

```sh
npm run eval:questionnaire-author -- --results path/to/results.json
```

The JSON result format is:

```json
{
  "benchmarkVersion": "kqa-questionnaire-review/1",
  "model": "provider/model snapshot",
  "skillVersion": "kqa-questionnaire-author commit or content hash",
  "promptVersion": "optional prompt version or hash",
  "runDate": "YYYY-MM-DD",
  "cases": [
    {
      "caseId": "customer-double-barrel",
      "findings": [
        {
          "questionId": "checkout",
          "category": "construct_scope",
          "severity": "moderate",
          "evidence": "How easy and secure",
          "rationale": "Ease and security are separate constructs.",
          "recommendation": "Ask one item for ease and one for perceived security."
        }
      ]
    }
  ]
}
```

Use `findings: []` when no issue is supported. A finding counts only when case, question location, category, non-empty evidence, rationale, recommendation, and severity are present and the location/category matches the annotation. The runner does not verify that evidence quotes the source or that rationale and recommendation are substantively correct; those require blinded human assessment. Confidence belongs to the live critique contract but is not currently scored by this benchmark. The runner reports micro precision/recall/F1, macro F1 over categories with any expected or predicted findings, category-level metrics, clean-control false-positive case rate, false alarms per 100 clean questions, and severity-weighted missed-issue rate. A finding with missing required fields or a duplicate pair does not earn a hit; it is counted as a false positive, and the expected issue remains a miss if unmatched. Unknown case/category values, duplicate case results, or incomplete case coverage are schema errors and stop scoring.

This scorer measures issue localization and actionable reporting against the current annotations. It does not score whether a rewrite preserves the construct, nor technical correctness, model truthfulness, accessibility, ethics decisions, or actual respondent response processes. Those need distinct checks and human review. Keep survee checker results in a separate format-validity lane and report them by diagnostic and fixture. Do not combine either lane into a single compensatory headline score.

## Build an enterprise evaluation program

The public corpus is a development tool only. Before using metrics to approve a model, prompt, package, or skill:

1. Create a larger frozen case bank from real briefs and questionnaires with permission, plus controlled seeded mutations. Cover full brief-to-questionnaire omissions as well as single-item faults. Include clean near-misses and context-dependent cases so the system can say `needs_context` instead of inventing a defect.
2. Have two qualified reviewers label cases independently using a published rubric, then adjudicate disagreements. Keep the blind holdout private to reduce label leakage; publish its version and method, not its answer key. Report seeded and naturally occurring cases separately.
3. Stratify cases across intended packages, populations, languages, supported question types, sensitivity, and risk. Include privacy, employment, health/service, educational, community, customer, event, operational, and personal contexts. Exclude use cases survee prohibits as a decision instrument; benchmark boundary handling separately.
4. Compare versions on identical inputs with randomized output IDs and blinded reviewers. Save model/provider snapshot, settings, system and task prompts, skill hash, corpus and rubric versions, raw outputs, timestamps, run costs, and adjudications. Repeat a subset to estimate generation variability.
5. Report per-category and per-risk-stratum precision, recall, F1, false positives per 100 clean questions, localization, unsupported assertions, and severity-weighted misses. Use predeclared hard gates for critical privacy or prohibited-use failures. For comparisons, report paired differences and uncertainty clustered by brief, not by treating each question as independent.
6. Score proposed revisions separately: retain stable IDs and answer meaning, resolve the finding, preserve intended coverage, and avoid introducing a new defect. A finding or plausible rewrite is not evidence of improved measurement.
7. For promising instruments, perform functional path checks and test with intended respondents. Use neutral probes for comprehension, recall/retrieval, judgment, and response selection; record participant fit, context, interpretation, revision, and unresolved issue. Report usability task observations and accessibility evaluation separately, even when gathered in the same session.

Do not report a model, prompt, or package as “validated” from this benchmark. AI critique and expert review are screening methods. Respondent-based cognitive pretesting and appropriate field evaluation remain necessary for the claims and decisions at stake. A small qualitative pretest is not a population estimate, and an excellent checker score is not content validity.

## Research basis

- [U.S. Census Bureau Statistical Quality Standard A2](https://www.census.gov/about/policies/quality/standards/standarda2.html) separates respondent pretesting from functional verification and questionnaire documentation.
- [Census Appendix A2](https://www.census.gov/about/policies/quality/standards/appendixa2.html) explains pretesting approaches and their complementary value.
- [CDC/NCHS Question Evaluation](https://www.cdc.gov/nchs/ccqder/question-evaluation/index.html) describes systematic evaluation of question performance and response error.
- [Pew Research Center: Writing Survey Questions](https://www.pewresearch.org/writing-survey-questions/) covers wording, response options, order, and pretesting.
- [ISER working paper on LLM survey pretesting](https://www.iser.essex.ac.uk/research/publications/publication-589050) is early evidence that prompt/model choice matters and simulated cognitive critique can complement expert review; its small seeded study is not a general survee target.
- [GESIS Survey Quality Predictor limitations](https://sqp.gesis.org/limits) describes domain and item-type limits of one measurement-quality resource; it is not a universal questionnaire oracle.
- [NCHS Q-Bank](https://wwwn.cdc.gov/QBANK/) provides question evaluation reports useful for future natural examples and controls.
- [AAPOR disclosure standards](https://aapor.org/standards-and-ethics/disclosure-standards/) support transparent reporting of questionnaire wording, population, sampling, and mode.
