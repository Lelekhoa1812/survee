# Package-based questionnaire draft benchmark

This benchmark reviews complete HTML questionnaires produced from KQA's interview packages. It is a separate lane from package selection, single-question critique, and KQA's static format checker. It asks whether a draft serves the brief, respects its boundaries, and has evidence appropriate to its readiness. The corpus is public and synthetic; results are development evidence only.

## Corpus and review protocol

The versioned cases are in [`package-draft-cases.json`](package-draft-cases.json), also served at `/api/docs/evals/package-draft-cases.json`. Version `kqa-package-draft/8` includes a source-noted full-draft brief for each of the 18 packages in the pinned `kqa-interview-packages/8` catalog plus nine cross-cutting cases. The multilingual public-consultation pair now reflects KQA's en-AU, Vietnamese, Spanish, and Arabic respondent shell: the first case treats vi/es/ar wording as an initial machine draft that needs qualified native-speaker and in-context review and end-to-end respondent testing before field use; its paired counterfactual describes a hypothetical, versioned, independently reviewed and tested language journey. This distinction follows Census A2 guidance on testing collection UI and supporting materials, GOV.UK language-navigation and Home Office limited-English guidance, and W3C's definition of localization; it does not claim that WCAG alone requires every interface string to be translated. Other cases cover industrial shift/contractor feedback, employee power imbalance and small-cell privacy, sensitive personal planning, maintenance prioritization, frontline resource-efficiency discovery, and self-directed personal-interest learning. The maintenance case tests when separate, independently rated items fit better than a forced full ranking; the resource-efficiency case separates worker observations from measured savings, emissions, or engineering conclusions; the personal-learning case distinguishes respondent-controlled self-reflection from institutional education or employment decisions; the shared-decision case protects one respondent’s views from being misrepresented as a household consensus or another person’s consent. Each case includes a brief, known and unresolved facts, required intents, acceptable alternatives, prohibited asks and claims, and non-compensatory hard gates. `sourceNotes` explain how the linked public guidance informs the scenario; the citations are background for case design, not endorsements of a generated draft or evidence that a package is validated. The cases intentionally allow different good question wording and flow. They are not canonical forms or a string-matching target. Changing the catalog requires a deliberate benchmark version update and review. To reproduce this release, run it from the matching source revision and catalog; the scorer deliberately rejects a different catalog rather than silently treating it as equivalent.

Coverage remains shallow: these 27 synthetic cases cannot represent package variants, jurisdictions, languages, recruitment modes, or risk contexts. These are public development cases, not a hidden holdout. Before using results for a release decision, add independently reviewed cases and a private holdout, and test with intended respondents.

For a run, retain the generated HTML and its human-readable review record. Have at least two independent reviewers assess every case before discussion: one with relevant domain knowledge and one with questionnaire/survey-methods expertise. Blind reviewers to model, prompt, skill, and each other's ratings where practical. Review the whole artifact, cite question IDs or exact passages as evidence, and record disagreements. Add expertise labels without exposing personal data. Adjudicate hard-gate disputes before claiming a draft is acceptable; preserve original ratings and the adjudication record.

Rate all eight dimensions from 0 through 3 for every case. The anchors in the corpus describe absent/unsafe (0), major gaps (1), mostly meets with material limitations (2), and clear and complete for this brief (3). Apply them to the named criterion: intent coverage means each required intent is substantively answerable; construct/question design means items are single-focus and interpretable; respondent/context fit means the stated audience can answer without assumed experience; response options/recall means options and reference periods support a defensible answer; flow/burden means sequence and effort fit the brief; privacy/risk means collection and use respect boundaries; analysis/interpretation means outputs support only the stated decision; review/evidence means assumptions, limits, and next checks are documented. These are exploratory common anchors, not calibrated measurement scales; train reviewers together on practice artifacts and adjudicate differences before comparing versions. A rating is a judgment with artifact evidence, not a model confidence score. Label every required intent `covered`, `partial`, `missing`, or `unsupported`, again with a citation. Report hard-gate findings independently. Any credible gate flag requires resolution; a high average cannot cancel it.

## Running the scorer

Save results matching [`package-draft-results.schema.json`](package-draft-results.schema.json), with one HTML and review-record pair per case, and run:

```sh
npm run eval:package-draft -- --results path/to/results.json
```

Paths in `outputs` are relative to the current working directory. The scorer hashes each HTML and review artifact, includes both hashes beside the case in the report, runs the KQA static checker on the HTML, validates complete case/reviewer/intent/dimension coverage, and reports descriptive ratings, pairwise exact agreement, mean absolute reviewer difference, and quadratic weighted kappa. Its `packageCoverage.byPackage` section summarizes case and reviewer counts, required-intent status counts, cases with missing or unsupported intents, evidence status by lane, and hard-gate flags and unresolved cases for each catalog package. Use it to see where the corpus or evidence is thin and where follow-up is needed; it deliberately defines no per-package readiness score or pass threshold. The JSON Schema describes the record shape; the CLI additionally validates cross-references and complete case coverage. For gate adjudication, add one `adjudications` record per disputed case/gate with an outcome, adjudicator ID, and rationale/evidence. The scorer retains the raw reviewer flags and ratings; a `cleared` outcome resolves a flag, while `confirmed` and `unresolved` remain blockers. Keep any broader review notes with the report. The scorer does not verify that human evidence is accurate or that reviewers are qualified or independent. Keep raw ratings and artifacts with the report.

### Run provenance (`kqa-package-draft-results/1`)

The result record has its own version, separate from the case corpus version. Keep the human-readable model, skill, and prompt labels, and include machine-checkable provenance:

```json
{
  "resultsSchemaVersion": "kqa-package-draft-results/1",
  "runProvenance": {
    "provider": "provider-name",
    "modelSnapshot": "immutable-provider-model-revision",
    "generationSettings": {
      "temperature": 0,
      "maxOutputTokens": 4096,
      "seed": "unavailable"
    },
    "promptSha256": "<64 lowercase hex characters>",
    "skillSha256": "<64 lowercase hex characters>",
    "reviewerBlinding": {
      "modelProvider": true,
      "prompt": true,
      "skill": true,
      "otherReviewerRatings": true,
      "exceptions": []
    }
  }
}
```

Record every effective generation parameter, including defaults and unavailable values, and use the provider's immutable model revision where one is available. Reviewer IDs should be pseudonymous and paired only with expertise roles; do not put reviewer names or personal details in the results file. `reviewerBlinding` records what the protocol says was concealed and explains every exception. The scorer checks required fields and formats; it cannot verify provider/model claims, actual reviewer independence, qualifications, or whether reviewers were truly blinded. Hashes help identify exact prompt, skill, and output artifacts, but do not establish their quality.

## Separate evidence lanes

For each case, report functional verification, accessibility assessment, and respondent pretesting as separate statuses: `not_tested`, `passed`, `issues_found`, or `not_applicable`. For `passed` or `issues_found`, cite the method and evidence; for `not_applicable`, explain why. A static checker result is only format evidence. Functional checks exercise supported paths and answer submission; for native text fields, include an over-limit paste, verify the full text remains visible and unsaved, verify it survives an unrelated answer refresh, and verify correction restores saving and clears the progression/submission block. Also test the warning before leaving with the unsaved draft; do not claim it survives reload. Accessibility assessment needs appropriate manual review and assistive technology testing; respondent pretesting should use intended people and neutral probes for comprehension, recall, judgment, and response selection. Do not substitute one lane for another or merge them into one compensatory score.

The runner reports ratings and agreement descriptively. It defines no overall pass threshold and provides no evidence that a model, skill, prompt, package, or questionnaire is validated, accessible, reliable, representative, or fit for a consequential decision. For enterprise release decisions, use a larger permissioned case bank, independent qualified reviewers, documented adjudication, a private holdout, relevant respondent testing, and predeclared risk gates. Preserve version IDs, provider/model snapshot, prompt and skill revisions, package catalog, raw outputs, review records, dates, and methods so a comparison can be reproduced.

## Research basis

- [U.S. Census Bureau Statistical Quality Standard A2](https://www.census.gov/about/policies/quality/standarda2.html) distinguishes documentation, functional verification, and respondent pretesting.
- [CDC/NCHS cognitive interviewing](https://www.cdc.gov/nchs/ccqder/question-evaluation/cognitive-interviewing.html) describes probing question comprehension and response processes.
- [COSMIN content validity guideline v2.0](https://pmc.ncbi.nlm.nih.gov/articles/PMC11541334/) emphasizes relevance, comprehensiveness, and comprehensibility for a defined construct and population; it is not a validation shortcut for general KQA forms.
- [Australian Bureau of Statistics Forms Design Standards](https://www.abs.gov.au/statistics/standards/abs-forms-design-standards/2023) gives practical principles for clear, accessible forms.
- [U.S. EPA ENERGY STAR industrial energy-management guidance](https://www.energystar.gov/industrial_plants/build-energy-management-program) describes employee involvement and energy teams; its [plant energy-assessment guidance](https://www.energystar.gov/industrial_plants/improve/plant-energy-auditing) distinguishes employee opportunity discovery from assessments used to demonstrate savings.
- [ABS Work-Related Training and Adult Learning methodology 2024–25](https://www.abs.gov.au/methodologies/work-related-training-and-adult-learning-methodology/2024-25) documents the scope and collection-method changes for personal-interest learning; it informs topic distinction only, not item validity.
- [Information Commissioner’s Office data-minimisation guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/data-minimisation/) informs purpose-limited collection; its legal applicability is jurisdiction- and context-specific.
- The GOV.UK [character-count component](https://design-system.service.gov.uk/components/character-count/) leaves over-limit text visible with corrective guidance; use this interaction as a reference for avoiding silent truncation.
- [NIST AI Risk Management Framework: Generative AI Profile](https://doi.org/10.6028/NIST.AI.600-1) supports documented, context-specific evaluation and explicit limitations.
- The individual case records cite relevant public sources, including [AHRQ's CAHPS development and patient-experience guidance](https://www.ahrq.gov/cahps/surveys-guidance/index.html), [OSHA worker-participation guidance](https://www.osha.gov/safeandsound/safety-and-health-programs/worker-participation), [EEOC employment-tests and selection-procedure guidance](https://www.eeoc.gov/laws/guidance/employment-tests-and-selection-procedures), the [CDC Program Evaluation Framework](https://www.cdc.gov/mmwr/volumes/73/rr/rr7306a1.htm), [GOV.UK consultation principles](https://www.gov.uk/government/publications/consultation-principles-guidance/consultation-principles-2018), and [ADA.gov web-accessibility guidance](https://www.ada.gov/resources/web-guidance/). Each `sourceNotes` field says what design boundary the cited guidance informed; legal and regulatory applicability remains jurisdiction- and context-specific.
