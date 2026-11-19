# Question blueprint

Use this lightweight record for new or materially changed questions, especially when purpose, interpretation, routing, sensitivity, or respondent burden is uncertain. For a short, low-risk questionnaire, a compact decision-to-question map may be enough. This is a design and testing aid, not a validated instrument or proof of suitability.

## One record per question

| Field | Record |
|---|---|
| Stable question ID and version | |
| Data-user need or decision this question supports | |
| Construct or observable information needed | |
| Respondent unit and in-scope population | |
| Reference period and context respondents should use | |
| Exact stem, instructions, and response options | |
| Answer type, requiredness, note behavior, and route conditions | |
| How the answer will be interpreted or reported | |
| What this answer must not be used to infer or decide | |
| Likely comprehension, recall, judgment, response-selection, sensitivity, or burden risks | |
| Cognitive probe(s) and intended participant/context, or reason no item pretest is planned | |
| Functional path to verify, including routing, save/return, and current review/export behavior | |

The question belongs in the instrument only when its information need and intended use are clear. If the host cannot explain how an answer will inform the stated purpose, remove it, revise the purpose, or record the unresolved decision. Keep `unknown` distinct from `not applicable`, `none`, and `prefer not to answer`; optionality and response options should fit the construct and respondent context.

## Record evidence separately

For cognitive pretesting, note which respondents were in scope and who participated, the item and surrounding questionnaire context tested, language and mode, probes used, what people said or did, observed interpretation differences, changes made, severity, and unresolved issues. Use comprehension, recall, judgment, and response-selection probes where relevant. A template review or expert critique does not substitute for respondents answering the question. Keep item-level cognitive findings separate from task-usability and accessibility findings even when a session combines methods.

For functional verification, state the input path, expected route/eligible questions, saved answer behavior, and the expected review/export treatment. survee's runtime probe is a limited round-trip smoke test; record routes, keyboard use, submission/locking, assistive-technology behavior, and respondent usability as untested unless they were actually exercised.

## Language and adaptation

When a questionnaire is offered in another language or cultural context, preserve meaning rather than translating words literally. Record who reviewed the adaptation, any disputed terms or local concepts, and whether intended-language respondents tried the items in the actual mode. Do not claim language coverage based only on an AI translation. survee's respondent shell supports `en-AU`, `vi`, `es`, and `ar`, detects a supported browser language on first visit, and lets respondents save a selector choice for one year. Shell locale and direction remain separate from the questionnaire document's authored `lang` and `dir`; shell translation does not translate the questionnaire, invitation, notices, or host-provided help. Vietnamese, Spanish, and Arabic shell wording has not yet received native-speaker or in-context respondent review. Record this translation and testing limit, arrange qualified language review, and test the complete intended-language journey before fielding; do not describe a language option alone as evidence that the full experience is localized, equivalent, or ready.

For each intended language and population, maintain a compact adaptation record alongside the question blueprint:

- Identify the source questionnaire and version, target language and region, translator and independent language/domain reviewers, and each reviewed version. Give reviewers the construct, audience, reference period, answer options, route, and intended use, not just isolated strings. Have them resolve differences in meaning or cultural fit and record unresolved terms and decisions. A back-translation or automated translation alone is not proof of equivalence.
- Check whether the translated stem, examples, option distinctions, units, dates, and instructions support the same intended interpretation. If an option or concept cannot be made comparable, record the difference and involve the host and analyst before combining or comparing results across languages. Do not change stable answer values or routing merely to translate a label; check each version's manifest and routes explicitly.
- Pretest with people from the intended language population, using the complete translated journey and actual collection mode. Record cognitive findings separately from usability and accessibility findings, changes made, and remaining gaps. Qualified review is valuable but does not replace respondent testing. If testing or review is unavailable, state that limit and leave field readiness to the accountable host under the release gate.
- When source wording, options, routing, notices, or shell text change, identify affected translations, repeat the appropriate review and testing, and record the version actually fielded. Do not assume a previously reviewed translation remains aligned with a changed source.

## Research basis

- The U.S. Census Bureau's [2025 question-template working paper](https://www.census.gov/library/working-papers/2025/adrm/rsm2025-07.html) reports that recording the research question, question universe, question text/responses, and testing concerns helped subject-matter experts and methodologists collaborate and connect programming with testing.
- Census [Statistical Quality Standard A2](https://www.census.gov/about/policies/quality/standards/standarda2.html) distinguishes instrument requirements, respondent pretesting, functional testing, and retained development evidence.
- CDC/NCHS describes cognitive probes for [comprehension, recall, judgment, and response selection](https://www.cdc.gov/nchs/ccqder/question-evaluation/cognitive-interviewing.html).
- Pew's [questionnaire translation guidance](https://www.pewresearch.org/questionnaire-design-and-translation/) emphasizes comparability of meaning across languages and iterative linguistic/local review.
- The U.S. Census Bureau's [translation-review process](https://www.census.gov/library/working-papers/2009/adrm/ssm2009-09.html) describes review involving translators, language reviewers, subject specialists, and survey methodologists; its [multilingual cognitive-testing research](https://www.census.gov/library/working-papers/2008/adrm/ssm2008-02.html) emphasizes testing translated questions with intended-language respondents. Adapt these methods to the survey's context rather than treating them as certification.
