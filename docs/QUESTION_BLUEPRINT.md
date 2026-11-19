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

For functional verification, state the input path, expected route/eligible questions, saved answer behavior, and the expected review/export treatment. KQA's runtime probe is a limited round-trip smoke test; record routes, keyboard use, submission/locking, assistive-technology behavior, and respondent usability as untested unless they were actually exercised.

## Language and adaptation

When a questionnaire is offered in another language or cultural context, preserve meaning rather than translating words literally. Record who reviewed the adaptation, any disputed terms or local concepts, and whether intended-language respondents tried the items in the actual mode. Do not claim language coverage based only on an AI translation. KQA's respondent shell supports `en-AU`, `vi`, `es`, and `ar`, detects a supported browser language on first visit, and lets respondents save a selector choice for one year. Shell locale and direction remain separate from the questionnaire document's authored `lang` and `dir`; shell translation does not translate the questionnaire, invitation, notices, or host-provided help. Vietnamese, Spanish, and Arabic shell wording has not yet received native-speaker or in-context respondent review. Record this translation and testing limit, arrange qualified language review, and test the complete intended-language journey before fielding; do not describe a language option alone as evidence that the full experience is localized, equivalent, or ready.

## Research basis

- The U.S. Census Bureau's [2025 question-template working paper](https://www.census.gov/library/working-papers/2025/adrm/rsm2025-07.html) reports that recording the research question, question universe, question text/responses, and testing concerns helped subject-matter experts and methodologists collaborate and connect programming with testing.
- Census [Statistical Quality Standard A2](https://www.census.gov/about/policies/quality/standards/standarda2.html) distinguishes instrument requirements, respondent pretesting, functional testing, and retained development evidence.
- CDC/NCHS describes cognitive probes for [comprehension, recall, judgment, and response selection](https://www.cdc.gov/nchs/ccqder/question-evaluation/cognitive-interviewing.html).
- Pew's [questionnaire translation guidance](https://www.pewresearch.org/questionnaire-design-and-translation/) emphasizes comparability of meaning across languages and iterative linguistic/local review.
