# Package-based questionnaire draft benchmark

This benchmark reviews complete HTML questionnaires produced from KQA's interview packages. It is a separate lane from package selection, single-question critique, and KQA's static format checker. It asks whether a draft serves the brief, respects its boundaries, and has evidence appropriate to its readiness. The corpus is public and synthetic; results are development evidence only.

## Corpus and review protocol

The versioned cases are in [`package-draft-cases.json`](package-draft-cases.json), also served at `/api/docs/evals/package-draft-cases.json`. Each case includes a brief, known and unresolved facts, required intents, acceptable alternatives, prohibited asks and claims, and non-compensatory hard gates. The cases intentionally allow different good question wording and flow. They are not canonical forms or a string-matching target. The cases pin `kqa-interview-packages/7`; changing that catalog requires a deliberate benchmark version update and review. To reproduce this release, run it from the matching source revision and catalog; the scorer deliberately rejects a different catalog rather than silently treating it as equivalent.

For a run, retain the generated HTML and its human-readable review record. Have at least two independent reviewers assess every case before discussion: one with relevant domain knowledge and one with questionnaire/survey-methods expertise. Blind reviewers to model, prompt, skill, and each other's ratings where practical. Review the whole artifact, cite question IDs or exact passages as evidence, and record disagreements. Add expertise labels without exposing personal data. Adjudicate hard-gate disputes before claiming a draft is acceptable; preserve original ratings and the adjudication record.

Rate all eight dimensions from 0 through 3 for every case. The anchors in the corpus describe absent/unsafe (0), major gaps (1), mostly meets with material limitations (2), and clear and complete for this brief (3). Apply them to the named criterion: intent coverage means each required intent is substantively answerable; construct/question design means items are single-focus and interpretable; respondent/context fit means the stated audience can answer without assumed experience; response options/recall means options and reference periods support a defensible answer; flow/burden means sequence and effort fit the brief; privacy/risk means collection and use respect boundaries; analysis/interpretation means outputs support only the stated decision; review/evidence means assumptions, limits, and next checks are documented. These are exploratory common anchors, not calibrated measurement scales; train reviewers together on practice artifacts and adjudicate differences before comparing versions. A rating is a judgment with artifact evidence, not a model confidence score. Label every required intent `covered`, `partial`, `missing`, or `unsupported`, again with a citation. Report hard-gate findings independently. Any credible gate flag requires resolution; a high average cannot cancel it.

## Running the scorer

Save results matching [`package-draft-results.schema.json`](package-draft-results.schema.json), with one HTML and review-record pair per case, and run:

```sh
npm run eval:package-draft -- --results path/to/results.json
```

Paths in `outputs` are relative to the current working directory. The scorer hashes each HTML and review artifact, runs the KQA static checker on the HTML, validates complete case/reviewer/intent/dimension coverage, and reports descriptive ratings, pairwise exact agreement, mean absolute reviewer difference, and quadratic weighted kappa. The JSON Schema describes the record shape; the CLI additionally validates cross-references and complete case coverage. For gate adjudication, add one `adjudications` record per disputed case/gate with an outcome, adjudicator ID, and rationale/evidence. The scorer retains the raw reviewer flags and ratings; a `cleared` outcome resolves a flag, while `confirmed` and `unresolved` remain blockers. Keep any broader review notes with the report. The scorer does not verify that human evidence is accurate or that reviewers are qualified or independent. Keep raw ratings and artifacts with the report.

## Separate evidence lanes

For each case, report functional verification, accessibility assessment, and respondent pretesting as separate statuses: `not_tested`, `passed`, `issues_found`, or `not_applicable`. For `passed` or `issues_found`, cite the method and evidence; for `not_applicable`, explain why. A static checker result is only format evidence. Functional checks exercise supported paths and answer submission; accessibility assessment needs appropriate manual review and assistive technology testing; respondent pretesting should use intended people and neutral probes for comprehension, recall, judgment, and response selection. Do not substitute one lane for another or merge them into one compensatory score.

The runner reports ratings and agreement descriptively. It defines no overall pass threshold and provides no evidence that a model, skill, prompt, package, or questionnaire is validated, accessible, reliable, representative, or fit for a consequential decision. For enterprise release decisions, use a larger permissioned case bank, independent qualified reviewers, documented adjudication, a private holdout, relevant respondent testing, and predeclared risk gates. Preserve version IDs, provider/model snapshot, prompt and skill revisions, package catalog, raw outputs, review records, dates, and methods so a comparison can be reproduced.

## Research basis

- [U.S. Census Bureau Statistical Quality Standard A2](https://www.census.gov/about/policies/quality/standarda2.html) distinguishes documentation, functional verification, and respondent pretesting.
- [CDC/NCHS cognitive interviewing](https://www.cdc.gov/nchs/ccqder/question-evaluation/cognitive-interviewing.html) describes probing question comprehension and response processes.
- [COSMIN content validity guideline v2.0](https://pmc.ncbi.nlm.nih.gov/articles/PMC11541334/) emphasizes relevance, comprehensiveness, and comprehensibility for a defined construct and population; it is not a validation shortcut for general KQA forms.
- [Australian Bureau of Statistics Forms Design Standards](https://www.abs.gov.au/statistics/standards/abs-forms-design-standards/2023) gives practical principles for clear, accessible forms.
- [NIST AI Risk Management Framework: Generative AI Profile](https://doi.org/10.6028/NIST.AI.600-1) supports documented, context-specific evaluation and explicit limitations.
