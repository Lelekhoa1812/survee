# Repeatable-record selection development benchmark

Version `kqa-repeatable-record-selection/1` at [`repeatable-record-selection-cases.json`](repeatable-record-selection-cases.json) contains 12 synthetic cases for choosing among fixed questions, checkboxes, optional text, a future repeated-record group, clarification, and out-of-scope handling. It tests industrial process learning, supplier improvement, personal planning, service feedback, and safety, privacy, and over-cap counterexamples.

This is a public development set, not a held-out benchmark or evidence that an agent, questionnaire, package, or interaction has been validated. Its case labels have not been independently adjudicated by survey-methods and domain experts. Repeated-record cases deliberately label the capability **unsupported in KQA today**. A result that recommends the future pattern must say so and provide a supported fallback. The score cannot evaluate rationale quality, respondent comprehension, burden, accessibility, or whether a particular use is legally or operationally appropriate.

Submit one result for every case using [`repeatable-record-selection.schema.json`](repeatable-record-selection.schema.json), then run:

```sh
npm run eval:repeatable-record-selection -- --results path/to/results.json
```

Example:

```json
{
  "benchmarkVersion": "kqa-repeatable-record-selection/1",
  "model": "provider/model snapshot",
  "runDate": "2026-11-19",
  "skillVersion": "KQA author skill commit or content hash",
  "cases": [
    {
      "caseId": "routine-handoff-episodes",
      "decision": {
        "pattern": "repeat_group",
        "formatStatus": "unsupported",
        "fallbackPattern": "optional_longtext",
        "clarificationSlots": [],
        "gates": ["finite_cap_and_period", "feature_unavailable_in_current_format"]
      }
    }
  ]
}
```

The scorer checks full case coverage and reports pattern accuracy, format-support accuracy, clarification-slot precision/recall/F1, gate precision/recall/F1, and non-compensatory hard-gate failures. It rejects a claim that repeated groups are currently supported. Hard gates include truthful feature disclosure, a defensible cap and period, a rule for selecting a subset at the cap, and boundaries against live logs, safety reporting, individual performance uses, and third-party inference. Review every failure; do not combine these metrics into a universal pass score.

Before using results to gate a model or release, have independent reviewers adjudicate the expected patterns and gates, create a private holdout, stratify by domain and respondent context, and review raw outputs blind. A production repeated-record interaction also requires prototype testing with intended respondents, including understanding of reference periods and caps, accessibility, save/resume, and exports. This benchmark is a screening aid, not that evidence.

Research context and current design constraints are documented in KQA's Repeatable records proposal. Primary references include [ODK repeat-group guidance](https://docs.getodk.org/form-logic/), the [HSE handover guidance](https://www.hse.gov.uk/humanfactors/topics/shift-handover.htm), [WCAG 2.2](https://www.w3.org/TR/WCAG22/), and [Frictionless Table Schema](https://specs.frictionlessdata.io/table-schema/). The proposal discusses evidence limits and export/accessibility requirements.
