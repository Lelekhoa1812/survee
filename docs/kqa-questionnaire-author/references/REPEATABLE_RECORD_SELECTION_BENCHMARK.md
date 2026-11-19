# Repeatable-record selection development benchmark

Version `kqa-repeatable-record-selection/2` at [`repeatable-record-selection-cases.json`](repeatable-record-selection-cases.json) contains 12 synthetic cases for choosing among fixed questions, checkboxes, optional text, supported bounded repeat groups, clarification, and out-of-scope handling. Version 2 updates the format-support labels after KQA shipped native repeat records. It tests industrial process learning, supplier improvement, personal planning, service feedback, and safety, privacy, and over-cap counterexamples.

This is a public development set, not a held-out benchmark or evidence that an agent, questionnaire, package, or interaction has been validated. Its case labels have not been independently adjudicated by survey-methods and domain experts. Repeat-group cases expect `formatStatus: "supported"` and no fallback; capability support alone does not make a proposed use suitable. The score cannot evaluate rationale quality, respondent comprehension, burden, accessibility, privacy protections in a real setting, or whether a use is legally or operationally appropriate.

Submit one result for every case using [`repeatable-record-selection.schema.json`](repeatable-record-selection.schema.json), then run:

```sh
npm run eval:repeatable-record-selection -- --results path/to/results.json
```

Example:

```json
{
  "benchmarkVersion": "kqa-repeatable-record-selection/2",
  "model": "provider/model snapshot",
  "runDate": "2026-11-19",
  "skillVersion": "KQA author skill commit or content hash",
  "cases": [
    {
      "caseId": "routine-handoff-episodes",
      "decision": {
        "pattern": "repeat_group",
        "formatStatus": "supported",
        "fallbackPattern": null,
        "clarificationSlots": [],
        "gates": ["finite_cap_and_period", "subset_rule_at_cap", "shared_fields_and_unit", "zero_rows_can_be_valid", "respondent_pretest"]
      }
    }
  ]
}
```

The scorer checks full case coverage and reports pattern accuracy, format-support accuracy, clarification-slot precision/recall/F1, gate precision/recall/F1, and non-compensatory hard-gate failures. It requires truthful disclosure that repeat groups are supported, without treating support as fit approval. Hard gates include a defensible cap and period, a rule for selecting a subset at the cap, shared field and unit fit, respondent pretesting, and boundaries against live logs, safety reporting, individual performance uses, and third-party inference. Review every failure; do not combine these metrics into a universal pass score.

Before using results to gate a model or release, have independent reviewers adjudicate the expected patterns and gates, create a private holdout, stratify by domain and respondent context, and review raw outputs blind. This capability-fit benchmark does not test the interaction itself. Repeat-record designs still require task-based testing with intended respondents, including understanding of reference periods and caps, accessible add/edit/remove and error recovery, save/resume, privacy expectations, and exports. Keep technical tests, question-content review, cognitive pretesting, usability testing, and accessibility evaluation as separate evidence lanes.

Research context and current design constraints are documented in [KQA's repeatable-record design guidance](REPEATABLE_RECORDS_DESIGN.md). References include [ODK repeat-group guidance](https://docs.getodk.org/form-logic/) as a precedent rather than direct usability evidence for KQA, [HSE handover guidance](https://www.hse.gov.uk/humanfactors/topics/shift-handover.htm) for the industrial example's limits, [WCAG 2.2](https://www.w3.org/TR/WCAG22/) for normative accessibility criteria, and [Frictionless Table Schema](https://specs.frictionlessdata.io/table-schema/) for typed, normalized export concepts.
