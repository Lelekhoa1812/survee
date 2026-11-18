# Interview packages for KQA agents

These packages are starting points for designing an interview, not validated instruments or ready-made legal, clinical, hiring, financial, or safety assessments. Choose one for the decision and audience; combine modules only where they serve the same purpose. Adapt the language, options, reference periods and length with the host. Do not present a package as certified or compliant. The host remains responsible for professional, legal and local review where needed.

Read [FORMAT.md](FORMAT.md), [AGENT_PLAYBOOK.md](AGENT_PLAYBOOK.md), and [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) before producing the complete HTML. The packages do not add question types, scoring or automated decisions to KQA. Supported choice-based conditional routing is described in FORMAT.md. A sample question below is a candidate, not a mandatory item; choose only those whose answers inform the stated decision. Give each selected question a stable, distinct ID and make it self-contained in exports.

## Common operating procedure

1. Establish the decision, intended respondents, context and timeframe, expected length, owner, and how answers will be used. Ask for missing facts when they are essential; state reasonable assumptions otherwise. Specify who can see identifiable responses, retention and contact details only when the host has supplied and verified them. Do not promise anonymity or confidentiality without evidence.
2. Select one package and draft a small set of neutral questions. Start with low-effort context, move to experience and evidence, then end with priorities and an optional comment. Ask one thing at a time and distinguish facts, perceptions and proposals. Give relevant non-applicability or uncertainty options where appropriate. Do not require an answer merely to increase completion.
3. Collect the least sensitive detail needed for the decision. Avoid names of third parties and identifying, health, financial or other sensitive details unless necessary and approved for the context. Provide an optional way to decline sensitive items. A collection question is not, by itself, a consent or privacy process.
4. Use native KQA controls and declarative `when` rules where possible. An eligible routed follow-up may be required; its requirement is suspended while inactive. Inactive answers are retained. Avoid implying that an answer triggers a live service, diagnosis, escalation or notification. Host actions use the MCP endpoint described in [MCP.md](MCP.md).
5. Pretest wording with representative respondents using cognitive interviews, then test the complete flow with representative users. Review accessibility, small screens and keyboard operation; run the static checker and, where possible, the in-app live check. Record what was actually tested, issues and unresolved limitations. For consequential uses, obtain an appropriate subject-matter review before release.

## Package selection

| Package | Decision supported | Respondents | Typical modules |
| --- | --- | --- | --- |
| Product discovery | What problem should a team investigate? | Customers or users | Recent experience, workaround, unmet need |
| Service improvement | Where should a service improve? | Service users | Journey, friction, recovery |
| Workplace process | Which process change deserves investigation? | Staff or process participants | Work context, handoffs, barriers |
| Project discovery | What needs clarification before planning? | Sponsors and delivery stakeholders | Outcomes, constraints, dependencies |
| Education and learning | What support could improve a learning experience? | Learners or educators | Goals, access, feedback |
| Health service experience | How can a service improve communication or access? | Patients or carers | Access, understanding, improvement |
| Personal planning | What matters to a person when planning a change? | An individual or household | Goals, resources, next steps |

## Product discovery

**Use for:** understanding a real problem, not validating a solution by asking respondents to predict purchases. Agree on the product area and a meaningful recent period first.

- Recent experience (`longtext`): “Thinking about the last time you [did the activity], what were you trying to accomplish?”
- Friction (`longtext`): “What, if anything, made that experience difficult?”
- Current approach (`longtext`): “How did you handle that difficulty, if it occurred?”
- Priority (`single`): “Which of these areas would be most useful to improve?” Use host-specific, distinct choices and an appropriate “none” or “not sure”.

**Review:** Avoid leading respondents toward a proposed feature, asking about hypothetical future behaviour as if it were evidence, or collecting customer account data without a need.

## Service improvement

**Use for:** mapping a defined service interaction. Identify which service and reference period the respondent can reasonably recall.

- Contact reason (`single` or `longtext`): “What was the main reason you contacted [service] during [period]?”
- Ease (`scale`): “How easy or difficult was it to complete what you needed?” Label both ends and make direction explicit.
- Barrier (`longtext`): “What, if anything, got in your way?”
- Improvement (`longtext`): “What one change would most improve this experience for you?”

**Review:** Do not ask people to repeat a sensitive incident unnecessarily. Do not represent an answer as a complaint, request for assistance or emergency report unless the host has an actual monitored process.

## Workplace process

**Use for:** understanding work and handoffs, not ranking individuals. Agree with the host on how responses will be used and who will see them.

- Context (`longtext`): “What is your role in [process]?”
- Handoff (`longtext`): “Where does work pass between people or teams in this process?”
- Obstacle (`longtext`): “During [period], what made this process harder to complete?”
- Change (`longtext`): “What change would make this process easier or more reliable?”

**Review:** Avoid requests to identify colleagues or attribute blame. Be explicit about whether responses are identifiable; do not promise anonymity. If decisions may affect employment, seek relevant professional review and do not use the questionnaire as an automated selection tool.

## Project discovery

**Use for:** finding agreement and gaps before committing to delivery. Ask stakeholders separately when their perspectives differ.

- Outcome (`longtext`): “What outcome should this project achieve for [audience]?”
- Evidence (`longtext`): “What evidence would show that outcome has been achieved?”
- Constraint (`longtext`): “What constraints should the team account for when planning?”
- Dependency (`longtext`): “What other work or decision does this project depend on?”
- Decision (`longtext`): “What decision needs to be made next, and by whom?”

**Review:** Separate goals from proposed solutions, assumptions from confirmed constraints, and targets from measured baselines. Avoid soliciting credentials, secrets or contractual documents in free text.

## Education and learning

**Use for:** improving an identified learning experience or support. Adapt to age, setting and respondent role; involve a responsible adult or institution where appropriate.

- Goal (`longtext`): “What would you like to be able to do after [learning activity]?”
- Access (`multi`): “Which formats help you take part?” Supply formats actually available and “other” as applicable. If offering “none of these”, prevent it from being selected alongside other options and test that behaviour, or use a separate question.
- Difficulty (`longtext`): “What, if anything, made it difficult to take part in [activity]?”
- Support (`longtext`): “What support would help you next time?”

**Review:** Do not infer ability, disability or achievement from a preference. Do not solicit unnecessary information about a child. Tailor language and consent arrangements to the participants and setting.

## Health service experience

**Use for:** improving access and communication about a service, not assessing symptoms or making clinical decisions.

- Access (`longtext`): “What, if anything, made it difficult to access [service]?”
- Understanding (`single`): “After your visit, how clear were the next steps explained to you?” Use balanced choices and “no next steps were discussed” where relevant.
- Questions (`longtext`): “What questions, if any, were left unanswered?”
- Improvement (`longtext`): “What could the service do differently to make communication clearer?”

**Review:** Use plain language and do not request diagnoses or medical histories unless necessary and separately reviewed. Do not suggest that answers are monitored for urgent needs. Get appropriate clinical and privacy review before collecting health information.

## Personal planning

**Use for:** an individual choosing a practical next step. Let the person define the scope; avoid prescriptive recommendations.

- Goal (`longtext`): “What would you like to be different by [timeframe]?”
- Importance (`longtext`): “Why does that matter to you?”
- Support (`longtext`): “What resources or support could help?”
- Next step (`longtext`): “What is one step you might take next?”

**Review:** Keep personal disclosures optional and avoid collecting detailed finances, health information or information about other people without a clear need. Do not frame the result as professional advice or a crisis service.

## Reusable agent brief

> Read the KQA format, playbook, design system and interview packages. Use the [package] package for [decision], for [respondents], about [scope and timeframe]. The host will use responses to [purpose]. Work within [length and constraints]. Adapt the example questions, do not assume all are needed. Propose neutral questions and suitable controls; state assumptions and flag sensitive collection or consequential decisions for host review. Produce a complete KQA HTML file, run the checker, and report actual checks and untested aspects. Preserve existing IDs and option values when revising a live questionnaire.

## Evidence and further reading

- The [CDC cognitive interviewing guide](https://www.cdc.gov/nchs/ccqder/question-evaluation/cognitive-interviewing.html) describes testing how respondents comprehend and answer survey questions. Cognitive testing complements, rather than replaces, an end-to-end usability session.
- W3C guidance covers [form labels](https://www.w3.org/WAI/tutorials/forms/labels/) and [instructions](https://www.w3.org/WAI/tutorials/forms/instructions/). Test the actual controls and interaction states, not just the presence of labels in a draft.
- The UK ICO's [purpose limitation](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/purpose-limitation/) and [data minimisation](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/data-minimisation/) guidance illustrates the relationship between a stated purpose and what data is needed. Applicable obligations depend on jurisdiction and context.
- AHRQ provides [plain-language communication guidance](https://www.ahrq.gov/health-literacy/improve/precautions/tool4.html) for health settings. Adapt terminology to the intended audience.
