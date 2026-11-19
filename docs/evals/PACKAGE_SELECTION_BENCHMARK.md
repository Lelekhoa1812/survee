# Package selection development benchmark

This is a second, separate authoring-evaluation track. Version `kqa-package-selection/4` at [`package-selection-cases.json`](package-selection-cases.json) contains 25 synthetic briefs spanning package fit, adjacent-package ambiguity, missing prerequisites, and boundaries where KQA must decline or clarify. New cases distinguish post-change process learning from formal management of change (MOC), local caregiver service feedback from use of a validated CAHPS measure, person-linked workforce climate feedback from a required anonymous collection, financial-wellbeing reflection from a request to score the CFPB Financial Well-Being Scale, population representativeness from digital-only reach, and KQA’s fixed questionnaire flow from live adaptive/longitudinal interviews. Cases are development examples only: labels are provisional, the set is small and public, and it is neither a held-out test set nor evidence that a package, prompt, or agent is validated. There is no universal pass score.

The added hard gates are narrow boundary labels: `moc-boundary` means KQA must not replace a site's formal MOC hazard review or startup authorization; `validated-instrument-boundary` means do not claim to reproduce or validate an established measure; `scoring-boundary` means KQA does not calculate answer scores; and `financial-data-minimization` calls for collecting only necessary financial information with qualified privacy/domain review. These labels do not determine legal or regulatory applicability. For covered process safety matters, qualified site owners must determine the applicable MOC process. The cited primary references include [OSHA's Process Safety Management standard](https://www.osha.gov/node/45918), [AHRQ's CAHPS Hospice Survey development and guidance](https://www.ahrq.gov/cahps/surveys-guidance/hospice/index.html), [CFPB's Financial Well-Being Scale guidance](https://www.consumerfinance.gov/data-research/research-reports/financial-well-being-scale/), and [OSHA worker-participation guidance](https://www.osha.gov/safety-management/worker-participation). The digital-access boundary is informed by [GOV.UK’s Digital Community Engagement Toolkit](https://www.gov.uk/government/publications/digital-community-engagement-toolkit-for-planning-consultations/digital-community-engagement-toolkit-for-planning-consultations) and [AHRQ CAHPS multiple-mode guidance](https://www.ahrq.gov/cahps/surveys-guidance/survey-methods-research/using-multiple-modes.html), which warn against assuming digital access and support planning modes for coverage. The live-interview boundary is grounded in KQA’s own current format and playbook: the product hosts authored HTML with declarative routing and does not provide a moderator or persistent longitudinal panel. These citations support the scenario boundaries; they do not certify a product or survey design.

The cases encode three actions:

- `recommend`: identify one suitable package and its stable package ID.
- `clarify`: do not force a package choice; name the candidate package IDs and the decision facts to clarify.
- `out_of_scope`: do not recommend a package for the stated use; state the relevant boundary gates.

Expected `acceptablePackageIds`, `candidatePackageIds`, clarification slots, and gates are distinct. A candidate set does not mean the packages are interchangeable. Clarification slots identify facts that could resolve the ambiguity, such as decision focus or respondent group. Gates are non-compensatory safeguards, not a risk score. In particular, an out-of-scope use cannot be made acceptable by high accuracy on routine cases, and missing required gates are counted as hard-gate failures.

Submit one result for every case using [`package-selection.schema.json`](package-selection.schema.json), then run:

```sh
npm run eval:package-selection -- --results path/to/results.json
```

Example result:

```json
{
  "benchmarkVersion": "kqa-package-selection/4",
  "model": "provider/model snapshot",
  "runDate": "2026-11-19",
  "promptVersion": "prompt hash or release",
  "packageLibraryVersion": "kqa-interview-packages/8",
  "cases": [
    {
      "caseId": "account-progress-or-friction",
      "decision": {
        "action": "clarify",
        "packageId": null,
        "candidatePackageIds": ["customer-success", "service-improvement"],
        "clarificationSlots": ["decision_focus"],
        "gates": []
      }
    }
  ]
}
```

The scorer checks full case coverage, an ISO calendar run date, and action-specific payload consistency. It reports action accuracy, package accuracy among recommendations, candidate-package precision/recall/F1 and clarification-slot precision/recall/F1 on clarify cases, and individual hard-gate failures. Candidate and slot metrics are micro-averaged across clarify cases; they award credit only when the predicted action is `clarify`, so a wrong action cannot receive clarification credit. Any action other than `out_of_scope` on an explicitly out-of-scope case is a hard-gate failure. These metrics still compare IDs, not the quality of the reasoning. The scorer does not judge whether a clarification is well phrased, whether a package rationale is convincing, or whether a proposed questionnaire is technically or methodologically sound. Review raw outputs and every gate failure. Do not collapse the results into a compensatory quality score or claim universal fit.

For a stronger evaluation, expand beyond these synthetic cases; have independent reviewers adjudicate expected decisions and safety boundaries; keep a versioned, private holdout; compare outputs blind on the same briefs; report results by domain and action; and collect task-based and domain-owner review evidence separately. Revisit labels when the package catalog changes. Cases involving minors, health, employment, safety, privacy, or certification need qualified review before any operational use.
