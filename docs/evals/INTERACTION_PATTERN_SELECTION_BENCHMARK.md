# Interaction-pattern selection development benchmark

Version `kqa-interaction-pattern-selection/1` at [`interaction-pattern-selection-cases.json`](interaction-pattern-selection-cases.json) contains 21 synthetic cases for choosing between survee's authored full-page, guided section, and guided-question presentations, plus bounded routing, full-order ranking, independent ratings, question-order variation, response-option randomization, repeat groups, required and optional answers, clarification, and out-of-scope handling. Cases include industrial operations, community consultation, service feedback, product discovery, personal planning, and employment-sensitive requests. Near-miss pairs test that interaction choices follow the intended decision and respondent context rather than a style preference.

The design draws on [U.S. Census Standard A2 Appendix A2](https://www.census.gov/about/policies/quality/standards/appendixa2.html), which calls for respondent-focused usability testing of interaction features such as navigation and error recovery and an a priori standard when comparing questionnaire versions; [Pew Research Center's survey question guidance](https://www.pewresearch.org/writing-survey-questions/), which distinguishes unordered options from ordinal categories when addressing response-order effects; and the [Australian Bureau of Statistics question-type standard](https://www.abs.gov.au/statistics/standards/abs-forms-design-standards/2023/general-forms-design-principles-question-type), which distinguishes nominal, ranking, rating, and numeric measurement and advises against ranking because it is cognitively demanding and disallows ties. survee ranking is a narrow option only when a complete forced order is itself the required construct and the list fits survee’s 2–8 option limit; otherwise independent ratings or a smaller decision set may be more appropriate. These sources inform case design. They do not validate survee's patterns or the provisional expected labels.

This is a public development set, not a held-out benchmark. It has not been independently adjudicated by domain and survey-methods reviewers, and it cannot establish that an agent's rationale is sound, that a pattern is usable or accessible for a real respondent, or that a questionnaire is suitable to field. The score does not establish enterprise readiness. Do not use a single aggregate metric as a release gate.

Submit one result for every case using [`interaction-pattern-selection.schema.json`](interaction-pattern-selection.schema.json), then run:

```sh
npm run eval:interaction-pattern-selection -- --results path/to/results.json
```

Example result:

```json
{
  "benchmarkVersion": "kqa-interaction-pattern-selection/1",
  "model": "provider/model snapshot",
  "runDate": "2026-11-19",
  "skillVersion": "KQA author skill commit or content hash",
  "cases": [
    {
      "caseId": "separate-service-dimensions",
      "decision": {
        "action": "recommend",
        "presentation": "all",
        "patterns": ["independent-ratings"],
        "clarificationSlots": [],
        "gates": ["avoid_forced_rank", "respondent_pretest"],
        "rationale": "Each dimension needs an independent judgment and may be tied or not applicable, so a forced total ordering would distort the decision."
      }
    }
  ]
}
```

The scorer checks complete and unique case coverage, valid action-specific payloads, and schema-like field constraints. In the survee checkout, run the npm command above. The portable skill bundle includes the same scorer beside its fixture; from that bundle directory run `node eval-interaction-pattern-selection.mjs --results path/to/results.json`. It reports action accuracy, presentation accuracy (overall and when specified), exact interaction-decision accuracy, exact pattern-set accuracy among recommendations, micro precision/recall/F1 for selected patterns, clarification facts, and safeguards, plus non-compensatory hard-gate failures. A hard failure includes selecting a prohibited interaction, omitting a required safeguard, recommending instead of clarifying a materially unresolved case, or failing to decline an explicitly out-of-scope use. Extra or missing patterns reduce pattern metrics; no other metric can cancel a hard failure. The scorer cannot assess the written rationale beyond requiring it to be present, so review raw outputs and every failure.

Before using results for model or release decisions, expand the cases across languages, modalities, sectors, and accessibility contexts; have independent domain and survey-methods reviewers adjudicate the labels; create a private holdout; compare model outputs blind on the same cases; and observe intended respondents completing representative tasks. Keep runtime conformance tests, question-content review, cognitive pretesting, usability, and accessibility evidence as separate lanes.
