# Interview packages for KQA agents

These packages are starting points for designing an interview, not validated instruments or ready-made legal, clinical, hiring, financial, or safety assessments. Choose one for the decision and audience; combine modules only where they serve the same purpose. Adapt the language, options, reference periods and length with the host. Do not present a package as certified or compliant. The host remains responsible for professional, legal and local review where needed.

Read [FORMAT.md](FORMAT.md), [AGENT_PLAYBOOK.md](AGENT_PLAYBOOK.md), and [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) before producing the complete HTML. The packages do not add question types, scoring or automated decisions to KQA. Supported choice-based conditional routing is described in FORMAT.md. A sample question below is a candidate, not a mandatory item; choose only those whose answers inform the stated decision. Give each selected question a stable, distinct ID and make it self-contained in exports.

## Common operating procedure

1. Establish the decision, intended respondents, context and timeframe, expected length, owner, and how answers will be used. Ask for missing facts when they are essential; state reasonable assumptions otherwise. Specify who can see identifiable responses, retention and contact details only when the host has supplied and verified them. Do not promise anonymity or confidentiality without evidence.
2. Select one package and draft a small set of neutral questions. Start with low-effort context, move to experience and evidence, then end with priorities and an optional comment. Ask one thing at a time and distinguish facts, perceptions and proposals. Give relevant non-applicability or uncertainty options where appropriate. Do not require an answer merely to increase completion.
3. Collect the least sensitive detail needed for the decision. Avoid names of third parties and identifying, health, financial or other sensitive details unless necessary and approved for the context. Provide an optional way to decline sensitive items. A collection question is not, by itself, a consent or privacy process.
4. Use native KQA controls and declarative `when` rules where possible. Use `maxSelections` only when a real upper bound serves the decision, and state that same limit in the checkbox help; it is a maximum, not a minimum. A cap does not make choices exclusive, so a “none” option still needs a separate question or a tested custom interaction. An eligible routed follow-up may be required; its requirement is suspended while inactive. Inactive answers are retained. Avoid implying that an answer triggers a live service, diagnosis, escalation or notification. Host actions use the MCP endpoint described in [MCP.md](MCP.md).
5. Keep a review record that maps each decision to the information needed, the question that collects it, the expected analysis, and an accountable owner. Mark assumptions, sensitive fields, branching rules, and any question that could affect an individual's access, employment, safety, money, or care. Do not turn descriptive answers into a score or automated decision.
6. Pretest wording with representative respondents using cognitive interviews, then test the complete flow with representative users. Review accessibility, small screens and keyboard operation; run the static checker and, where possible, the in-app live check. Record what was actually tested, issues and unresolved limitations. For consequential uses, obtain an appropriate subject-matter review before release.
7. Use staged release gates when the context warrants them: discovery confirms the user need and population; an alpha review tests wording and flow; a limited beta pilot checks completion, routing, and exported data; live operation monitors burden and data quality; retirement follows the host's retention and deletion policy. KQA supplies the questionnaire checker and live check, but does not run these phases, recruit testers, monitor respondents, or set retention policy.

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
| Candidate experience | How can a hiring process improve for applicants? | Candidates | Clarity, access, communication |
| Employee onboarding | Where can a new starter's first weeks improve? | New employees | Access, role clarity, support |
| Customer success | What helps a customer reach an agreed outcome? | Customers or account contacts | Goals, use, blockers, support |
| Supplier and partner review | Which working relationship or delivery issue needs attention? | Suppliers, partners, internal owners | Delivery, coordination, risks |
| Safety learning | What conditions can help prevent recurrence? | Staff or service participants | Context, barriers, learning |
| Audit readiness | What evidence or process gaps need follow-up? | Process owners | Control awareness, evidence location, owner |
| Program evaluation | How did a defined program work for participants? | Participants and delivery partners | Reach, experience, outcomes |
| Community consultation | What local priorities should inform a decision? | Residents or community groups | Needs, impacts, trade-offs |
| Event feedback | What should organizers keep or change? | Attendees, speakers, staff | Access, experience, logistics |
| Personal wellbeing reflection | What support or next step would a person choose? | An individual | Self-defined needs, preferences, next step |

## Additional sector modules

Use these as narrowly scoped modules within a package. They are prompts for an interview, not a validated assessment, audit, incident channel, or professional service.

### Candidate experience

**Use for:** improving application and interview steps, not ranking candidates or deciding who should be hired.

- Clarity (`scale`): “How clear were the next steps in the [stage] process?” Label both ends and include “not applicable” if some candidates did not reach that stage.
- Access (`longtext`): “Was there anything that made it difficult to take part in the process?”
- Communication (`single`): “When did you receive an update?” Use time ranges that match the actual process, plus “I did not receive an update”.
- Improvement (`longtext`): “What is one change that would make the process clearer or easier to take part in?”

**Review:** collect no protected attributes or unnecessary employment history. Keep this feedback separate from selection records and do not treat it as a candidate score.

### Employee onboarding and workplace experience

**Use for:** finding changes to onboarding, tools, role clarity, or team processes.

- Access (`single` then conditional `multi`): “Were the tools or resources you needed ready?” If yes, ask “Which ones were ready?” Use actual resources in the checkbox list. KQA does not enforce mutually exclusive checkbox choices, so do not combine a “none” option with selectable resources in one `multi` question.
- Role clarity (`scale`): “How clear are your current responsibilities?” State the reference period.
- Support (`longtext`): “What would have helped you do your work in your first month?”
- Process (`longtext`): “Which handoff or step should we improve?”

**Review:** state who can see identifiable answers and how they will be used. Do not promise anonymity when roles or small teams make people identifiable. Do not use experience feedback as a proxy for performance.

### Customer success and account review

**Use for:** checking whether an agreed service or product is helping with a stated customer goal.

- Goal (`longtext`): “What outcome were you hoping to achieve with [service]?”
- Progress (`scale`): “How much progress have you made toward that outcome?” Define scale endpoints and timeframe.
- Blocker (`longtext`): “What, if anything, is getting in the way?”
- Next step (`single`): “Which next step would be most useful?” Offer only options the team can actually provide.

**Review:** do not ask for passwords, payment details, confidential account data, or details already available to the account team. Do not imply a response creates a support ticket unless the host has configured that workflow.

### Supplier and partner review

**Use for:** identifying delivery, coordination, and relationship issues for a defined contract or period.

- Delivery (`scale`): “How consistently did [deliverable] meet the agreed schedule during [period]?”
- Quality (`longtext`): “Where did the delivered work meet or miss the agreed requirements?”
- Coordination (`single`): “How well did the teams coordinate decisions?” Use balanced, labelled options.
- Risk (`longtext`): “What should the teams resolve before the next milestone?”

**Review:** identify the scope and parties, avoid collecting commercially sensitive detail beyond the need, and keep the questionnaire separate from formal contract notices and procurement decisions.

### Safety and quality learning

**Use for:** understanding conditions, barriers, and possible prevention actions after a defined activity.

- Context (`longtext`): “What was happening immediately before the issue or near miss?”
- Conditions (`multi`): “Which conditions may have contributed?” Include “not sure” separately from selectable factors.
- Barrier (`longtext`): “What made the safer or expected process difficult to follow?”
- Learning (`longtext`): “What change could reduce the chance of this happening again?”

**Review:** this is not an emergency, statutory incident, hazard-reporting, or clinical channel. State the monitored reporting route and its response time separately; do not ask for unnecessary names or blame individuals.

### Audit and compliance readiness

**Use for:** locating process gaps and owners before an authorized review; not certifying compliance.

- Process (`select`): “Which process are you responsible for?” Populate with the actual approved process list.
- Evidence (`single`): “Can the current evidence be located?” Use “yes”, “partly”, “no”, and “not applicable”.
- Gap (`longtext`): “What prevents the evidence or control from being available?”
- Owner (`text`): “Which role should follow up?” Ask for a role where possible, not a personal name.

**Review:** do not collect credentials, secrets, regulated records, or evidence files in free-text answers. Use the authorized evidence system; have a qualified owner interpret requirements and approve conclusions.

### Program evaluation and community consultation

**Use for:** learning whether a defined service, grant, event series, or public initiative reached people and what should change.

- Participation (`single`): “Which activities did you take part in?” Use a checkbox if multiple activities are possible.
- Access (`longtext`): “What made it easier or harder to take part?”
- Experience (`scale`): “How well did the activity meet the need you came with?” State the audience and timeframe.
- Priority (`multi`): “Which changes should be considered next?” Avoid presenting the result as representative unless the sampling method supports that claim.

**Review:** explain how responses will inform the decision, include accessible participation options, and describe whose perspectives are missing. A before-and-after opinion question alone does not establish causal impact.

### Event feedback

**Use for:** improving a specific event's access, schedule, content, or logistics.

- Attendance (`select`): “Which part of [event] did you attend?”
- Access (`longtext`): “Was there anything that made it difficult to participate?”
- Value (`scale`): “How useful was [session or event] for your stated purpose?”
- Change (`longtext`): “What should organizers keep, change, or remove next time?”

**Review:** provide an alternative route for access requests that need action, and do not imply the survey itself will arrange accommodations or reply to a complaint.

### Personal reflection and wellbeing

**Use for:** helping a person describe a goal or preference and choose a self-directed next step.

- Priority (`multi`): “Which areas would you like to focus on?”
- Importance (`longtext`): “What makes this matter to you now?”
- Confidence (`scale`): “How confident do you feel about taking a next step this week?”
- Choice (`longtext`): “What is one small step you would like to try?”

**Review:** let the person skip sensitive questions, avoid collecting diagnoses or detailed financial and relationship information, and do not present responses as clinical screening, therapy, financial advice, or crisis support.

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

> Read the KQA format, playbook, design system and interview packages. Use the [package] package for [decision], for [respondents], about [scope and timeframe]. The host will use responses to [purpose]. Work within [length and constraints]. Adapt examples rather than assuming all are needed. Before drafting, map each decision to the evidence needed and each question to a clear construct; identify assumptions, excluded respondents, sensitive data, privacy/retention facts supplied by the host, and any consequential use. Ask one concise batch of essential questions if those details are missing; otherwise state reasonable assumptions. Propose neutral, self-contained questions and balanced response options; use routing only where it changes applicability and disclose retained inactive answers. Do not invent consent, anonymity, a monitored response process, certification, scoring, or an automated decision. Produce one complete KQA HTML file plus a short review record showing the decision-to-question map, assumptions, routing, risks requiring host review, checker result, rendered/accessibility checks performed, and untested aspects. Preserve existing IDs and option values when revising a live questionnaire.

## Evidence and further reading

- The [CDC cognitive interviewing guide](https://www.cdc.gov/nchs/ccqder/question-evaluation/cognitive-interviewing.html) describes testing how respondents comprehend and answer survey questions. Cognitive testing complements, rather than replaces, an end-to-end usability session.
- The Australian Bureau of Statistics [Forms Design Standards](https://www.abs.gov.au/statistics/standards/abs-forms-design-standards/2023) combine survey research and practical advice on question development, respondent burden, visual design, and testing. They are a strong Australian reference; their standard wording and examples do not automatically fit every KQA use case.
- The UK Government Analysis Function's [Questionnaire Design Guidance](https://analysisfunction.civilservice.gov.uk/policy-store/questionnaire-design-guidance/) and [Survey Development Toolkit](https://analysisfunction.civilservice.gov.uk/policy-store/survey-development-toolkit/) describe respondent-centred discovery, alpha/beta/live phases, question pretesting, and the difference between cognitive and usability testing. Adapt their methods to the host's context and resources.
- W3C guidance covers [form labels](https://www.w3.org/WAI/tutorials/forms/labels/) and [instructions](https://www.w3.org/WAI/tutorials/forms/instructions/). Test the actual controls and interaction states, not just the presence of labels in a draft.
- The UK ICO's [purpose limitation](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/purpose-limitation/) and [data minimisation](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/data-minimisation/) guidance illustrates the relationship between a stated purpose and what data is needed. Applicable obligations depend on jurisdiction and context.
- The Australian OAIC's [APP 3 guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-3-app-3-collection-of-solicited-personal-information) explains Australian Privacy Principle collection limits, including reasonable necessity and data minimisation; its application depends on the organisation and context. OAIC's [Privacy by Design guidance](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/privacy-impact-assessments/privacy-by-design) recommends identifying information flows and privacy risks early and revisiting them as a project changes.
- AHRQ provides [plain-language communication guidance](https://www.ahrq.gov/health-literacy/improve/precautions/tool4.html) for health settings. Adapt terminology to the intended audience.
