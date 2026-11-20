# Interview packages for survee agents

These packages are starting points for designing an interview, not validated instruments or ready-made legal, clinical, hiring, financial, or safety assessments. Choose one for the decision and audience; combine modules only where they serve the same purpose. Adapt the language, options, reference periods and length with the host. Do not present a package as certified or compliant. The host remains responsible for professional, legal and local review where needed.

Read [FORMAT.md](FORMAT.md), [AGENT_PLAYBOOK.md](AGENT_PLAYBOOK.md), and [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) before producing the complete HTML. The packages do not add question types, scoring or automated decisions to survee. Supported bounded routing includes choice, numeric, scale, and date comparisons plus checks for whether an earlier answer is present; FORMAT.md defines its limits and missing-value behavior. A sample question below is a candidate, not a mandatory item; choose only those whose answers inform the stated decision. Give each selected question a stable, distinct ID and make it self-contained in exports.

The package library is versioned as `kqa-interview-packages/12`. Its 18 stable IDs are listed in the catalog below and are accepted by the MCP `get_interview_packages` tool. Set `catalogOnly: true` for just the compact structured metadata; omit both arguments to retrieve the complete library; pass one `packageId` to retrieve shared operating and risk safeguards, sampling guidance, and only that package's detailed module. MCP returns decision focus, intended respondents, when to use or avoid each package, risk flags, adjacent packages, and structured interaction considerations. Choose by purpose, audience, and collection context; if the brief is ambiguous, show the closest candidates and ask rather than producing a false fit score. Record the package ID and library version in the review record so later revisions remain traceable.

### Interaction pattern considerations

Each package's `interactionGuidance` metadata gives context-specific patterns to consider, their possible benefit and tradeoff, patterns to avoid in stated circumstances, and decision checks. It does not select a required flow, assert a default, or score package fit. An omitted pattern is neither recommended nor ruled out; resolve it against the actual brief, respondent group, device, accessibility needs, and evidence.

Start with the shortest clear all-at-once flow unless task and respondent evidence supports section-guided or question-guided presentation. Keep routes bounded and based on earlier answers that determine applicability; inactive answers remain saved and must be disclosed. A native rank requires ordering every option and is appropriate only when strict relative order is the construct; choose independent ratings when ties, non-applicability, or unranked items matter. Repeat rows are only for distinct instances of one small structured unit, never as incident, shift, or live operational logs. Randomize only unordered nominal options when position effects are plausible, preserve fixed choices by explicit stable value, and retain presentation-order provenance. See the interaction evaluation and pretest guidance in the authoring skill; public synthetic benchmarks are not held-out or respondent evidence.

For complete but deliberately illustrative flows, see the runnable [service-improvement questionnaire](examples/service-improvement.kqa.html) with its [review record](examples/service-improvement.review.md), the [industrial-operations questionnaire](examples/industrial-operations.kqa.html) with its [review record](examples/industrial-operations.review.md), and the [personal-planning questionnaire](examples/personal-planning.kqa.html) with its [review record](examples/personal-planning.review.md). Each pairs a package-specific purpose and question map with survee markup and an explicit evidence record; the industrial example also demonstrates the opt-in one-question flow and a conditional follow-up. None is validated, field-tested, or suitable to launch unchanged; replace assumptions and obtain the host's approvals and respondent evidence appropriate to the actual context.

The hosted assets are also served as [service-improvement HTML](/api/docs/examples/service-improvement.kqa.html), [service-improvement review](/api/docs/examples/service-improvement.review.md), [industrial-operations HTML](/api/docs/examples/industrial-operations.kqa.html), [industrial-operations review](/api/docs/examples/industrial-operations.review.md), [personal-planning HTML](/api/docs/examples/personal-planning.kqa.html), and [personal-planning review](/api/docs/examples/personal-planning.review.md).

For a defined method to review complete package-based drafts, see the [package-draft evaluation benchmark](evals/PACKAGE_DRAFT_BENCHMARK.md). It keeps expert content review, survee format checks, functional verification, accessibility assessment, and respondent pretesting as separate evidence lanes. Packages and examples are starting points, not validated instruments.

survee hosts self-completed HTML questionnaires. It does not provide a live moderator, interviewer probes, or a qualitative interview guide. If the host means a synchronous moderated interview, use these packages only as source material and create a separate moderator guide and recording process.

## Common operating procedure

1. Establish the decision, intended respondents, context and timeframe, target completion time, owner, and how answers will be used. Ask for missing facts when they are essential; state reasonable assumptions otherwise. The accountable host must approve a respondent-facing notice covering purpose, who will see identifiable answers, how answers will be used, retention or deletion expectations, and a contact route. Include only facts the host has supplied and verified; do not invent a privacy promise or treat this notice as legal consent.
2. Select one package and draft a small set of neutral questions. Start with low-effort context, move to experience and evidence, then end with priorities and an optional comment. Ask one thing at a time and distinguish facts, perceptions and proposals. Give relevant non-applicability or uncertainty options where appropriate. Do not require an answer merely to increase completion.
3. Collect the least sensitive detail needed for the decision. Avoid names of third parties and identifying, health, financial or other sensitive details unless necessary and approved for the context. Provide an optional way to decline sensitive items. A collection question is not, by itself, a consent or privacy process.
4. Use native survee controls and declarative `when` rules where possible. Use `maxSelections` only when a real upper bound serves the decision, and state that limit in checkbox help. Use `minSelections` only when the decision genuinely needs a minimum number of choices, and explain the range and skip behavior in help. A minimum applies to non-empty answers: an optional blank is a valid skip, but a partial non-empty answer autosaves and must be completed before guided Continue or final submission. `minSelections` cannot exceed `maxSelections`; survee does not silently add or remove selected options. For a multi-select option that must stand alone, declare its value in `exclusiveOptions` and make that status clear in the respondent-facing label or help (for example, “None of these — choose alone”); survee enforces the rule and announces automatic clearing. Custom controls must implement the same behavior. An eligible routed follow-up may be required; its requirement is suspended while inactive. Inactive answers are retained. Avoid implying that an answer triggers a live service, diagnosis, escalation or notification. Host actions use the MCP endpoint described in [MCP.md](MCP.md).
   Use `repeat` only when each respondent may report multiple distinct instances of the same defined unit, every row uses the same compact field set, and separate records matter to the decision. Explain the row unit, timeframe, whether all instances or a subset should be reported, and what to do at the finite maximum. Avoid repeat groups for open-ended histories or operational logs; repeat rows remain person-linked, are omitted from default analytics, and are absent from CSV exports.
5. Keep a review record that maps each decision to the information needed, the question that collects it, the expected analysis, and an accountable owner. Mark assumptions, sensitive fields, branching rules, and any question that could affect an individual's access, employment, safety, money, or care. Do not turn descriptive answers into a score or automated decision.
6. For work that touches employment, education access, health, safety, public benefits, finances, or other consequential outcomes, involve a qualified domain owner and the appropriate legal, privacy, accessibility, and methodology reviewers before collection. Keep experience research separate from eligibility, performance, diagnosis, compliance certification, and incident reporting; a separately governed process does not make survee itself a decision instrument for those uses.
7. Pretest wording with representative respondents using cognitive interviews, then test the complete flow with representative users. These methods may share a moderated session where practical, but retain separate findings. Review accessibility, small screens and keyboard operation; run the static checker and, where possible, the in-app live check. Record what was actually tested, issues and unresolved limitations. For consequential uses, obtain an appropriate subject-matter review before release.
8. For feedback or consultation, agree before collection how participants will hear what the host learned and what happened next. Name the accountable owner, target timing and channel, the decisions that can and cannot change, and how the host will protect people when reporting small groups or sensitive comments. If no report-back is planned, state that plainly. This is a host commitment: survee does not monitor outcomes, notify participants of decisions, or confirm that actions were taken. For self-reflection or other uses where report-back does not fit, state why in the review record.
9. Apply the [risk-based release gate](#risk-based-release-gate) before fielding. A clean checker result is only a technical check; it does not establish that the method, content, accessibility, privacy, or use is suitable.

### Worker participation and power differences

For workplace, industrial, onboarding, and other worker-facing feedback, agree a participation plan with the accountable host and, where appropriate, worker representatives before inviting people. A survey invitation alone does not establish that workers can speak freely. Record the following in the review record:

- **Access and choice:** Identify which workers can participate, including relevant shifts, locations, contractors and temporary staff; plan practical time, language, accessibility and device support. State whether participation and each item are voluntary only when the host has verified that this is true; explain any known consequences or obligations accurately. Do not promise an absence of consequences without an accountable, verified basis.
- **Pressure and privacy:** Identify who sends invitations, can see participation and person-linked answers, receives exports, and can access reports. Consider whether supervisors could observe participation or screen contents, or apply pressure, and provide a private opportunity and a host-approved contact outside the worker's reporting line where feasible. Do not ask supervisors to collect completed responses. No question wording or suppression rule makes survee anonymous: if a genuinely anonymous channel is needed, arrange a separately verified method outside survee.
- **Use and reporting:** Limit access and intended use to the host-approved purpose; do not use feedback for individual appraisal or employment decisions. Review free text and combinations of role, shift, location, asset and timing before sharing; use aggregation or suppress details where appropriate, while recognizing that either can still disclose identity. Agree who will review concerns, how workers can raise concerns through an appropriate independent or monitored channel, and how and when the host will report back without identifying respondents.

Discuss unresolved risks with the host, relevant worker representatives and privacy/workforce reviewers. If a material privacy fact or required review remains unresolved, do not field; if the necessary worker protections cannot be provided, use a different, verified process. The [OSHA worker-participation guidance](https://www.osha.gov/safety-management/worker-participation) addresses barriers, retaliation, worker involvement and access for contractors and temporary staff in safety programs; [NIOSH's Total Worker Health workbook](https://www.cdc.gov/niosh/docs/2017-112/pdfs/2017_112.pdf) discusses workplace data, confidentiality and worker involvement. These sources inform planning; they do not guarantee safety, establish legal compliance in every jurisdiction, or validate this questionnaire.

## Risk-based release gate

Before drafting, ask the accountable host to classify the intended use and identify the owner who can approve fielding. The agent can flag risks and propose a classification, but must not certify it. Classify by the highest applicable use:

- **Routine learning or service feedback:** answers inform general research or service improvement and are not used to decide an individual's eligibility, employment, care, safety, money, discipline, or legal status.
- **Sensitive or regulated collection:** the questionnaire collects sensitive, regulated, or otherwise high-impact personal information, even if answers are not used to make individual decisions.
- **Consequential individual use:** answers would make or materially support a decision about a person's access, employment, education, care, safety, finances, benefits, discipline, or legal status; diagnose a condition; certify compliance; or replace an incident or emergency reporting route.

For every use, keep a release record with separate evidence for technical behavior, method fit and sampling, question pretesting, task-based usability, accessibility, privacy, and any relevant domain/legal review. Mark each area **passed**, **issues found**, **not tested**, or **not applicable**; state the scope, evidence, reviewer, limitations, and unresolved actions. Give a reason and accountable reviewer for each not-applicable item. A proposed test plan is not test evidence. Do not combine areas into an average score or let one passing check waive another.

For routine use, field only after the accountable owner reviews the purpose, population, privacy facts, technical checks, and remaining limitations. For sensitive or regulated collection, also require documented review by the appropriate privacy and domain owners, plus legal or ethics review when the context requires it. Unresolved issues in a required review block fielding until the accountable reviewer records a disposition.

### Respondent notice, privacy, and ethics

Before invitations go out, show a host-approved notice in the questionnaire or invitation that explains the purpose, what participation involves, who can access identifiable answers, how answers will be used, retention/deletion expectations, and how to contact the responsible host. survee associates each private link and its answers with a participant record; hosts can review person-level answers. Aggregate analysis does not anonymize stored records, and small groups, attribute combinations, and free-text answers can identify people even without a name field. Current survee modes do not provide anonymous cohort collection. If strict anonymity is required, pause and use a separately verified method rather than promising anonymity in survee. State whether responses are identifiable or confidential only when the host verifies the actual access and data flow. survee does not provide consent management, guarantee anonymity, set retention, or determine whether research ethics review is required.

Record each notice item as confirmed, not applicable with a reason, or unresolved. A material unresolved purpose, access, use, retention, or contact fact blocks fielding until the accountable owner resolves it or records why it does not apply. If an activity may be human-subjects research, ask the host to obtain a determination from its responsible ethics/HRPP/IRB office; the agent must not make that determination. Obtain any required consent or ethics materials through the host's approved process rather than inventing them in questionnaire copy.

### Field monitoring and respondent burden

Set a target completion time before testing. Record observed completion time (range or median, with method and participant context) when it is measured; do not present a prediction as observed evidence. If timing or drop-off cannot be measured, say so. survee does not collect item display telemetry, automatically monitor completion, or notify a host when answers arrive. The host's field plan should name the collection window, review owner and cadence, available completion/disposition checks, anomaly or safety escalation route, and stop/extend criteria. Use only evidence available from survee's manual progress refresh and approved external processes; do not imply a live monitor exists.

If AI assisted drafting, review, translation, or synthetic testing, record its role, model/provider and prompt/version when known, the human reviewer and decision, what validation occurred, and the number and type of human versus synthetic test participants. Synthetic responses can test code paths or surface candidate questions; they are not respondent evidence and must not be counted as human completes or used to estimate real response patterns.

Do not use a survee questionnaire as the decision instrument for consequential individual decisions, diagnosis, compliance certification, or incident/emergency reporting. Stop and direct the host to a separately governed, professionally reviewed process. If an otherwise approved program uses survee only to collect non-decisional experience feedback, keep that purpose, access, and reporting boundary explicit and independently reviewed.

Keep the evaluations distinct: expert or method review does not replace pretesting questions with in-scope respondents; cognitive pretesting does not show that people can complete the full flow; automated accessibility checks do not establish accessibility conformance. For appropriate projects, use staged discovery, alpha review, limited beta, live monitoring, and retirement gates; survee does not recruit testers, monitor respondents, or set retention policy.

## Package selection

The structured catalog has richer respondent-interaction considerations than this compact comparison table. Retrieve `get_interview_packages({ catalogOnly: true })` for the complete metadata, then resolve each suggestion against the intended respondents and decision.

| Package or module | Type | Decision supported | Respondents | Typical modules | Stable ID |
| --- | --- | --- | --- | --- | --- |
| Product discovery | Full package | What problem should a team investigate? | Customers or users | Recent experience, workaround, unmet need | `product-discovery` |
| Service improvement | Full package | Where should a service improve? | Service users | Journey, friction, recovery | `service-improvement` |
| Workplace process | Full package | Which process change deserves investigation? | Staff or process participants | Work context, handoffs, barriers | `workplace-process` |
| Industrial operations | Full package | Where can recurring production or maintenance flow improve? | Operators, maintenance, planning and process partners | Delays, handoffs, constraints, improvement ideas | `industrial-operations` |
| Project discovery | Full package | What needs clarification before planning? | Sponsors and delivery stakeholders | Outcomes, constraints, dependencies | `project-discovery` |
| Education and learning | Full package | What support could improve a learning experience? | Learners or educators | Goals, access, feedback | `education-learning` |
| Health service experience | Full package | How can a service improve communication or access? | Patients or carers | Access, understanding, improvement | `health-service-experience` |
| Personal planning | Full package | What matters to a person when planning a change? | An individual or household | Goals, resources, next steps | `personal-planning` |
| Candidate experience | Sector module | How can a hiring process improve for applicants? | Candidates | Clarity, access, communication | `candidate-experience` |
| Employee onboarding | Sector module | Where can a new starter's first weeks improve? | New employees | Access, role clarity, support | `employee-onboarding` |
| Customer success | Sector module | What helps a customer reach an agreed outcome? | Customers or account contacts | Goals, use, blockers, support | `customer-success` |
| Supplier and partner review | Sector module | Which working relationship or delivery issue needs attention? | Suppliers, partners, internal owners | Delivery, coordination, risks | `supplier-partner-review` |
| Safety learning | Sector module | What conditions can help prevent recurrence? | Staff or service participants | Context, barriers, learning | `safety-quality-learning` |
| Audit and compliance readiness | Sector module | What evidence or process gaps need follow-up? | Process owners | Control awareness, evidence location, owner | `audit-readiness` |
| Program evaluation | Sector module | How did a defined program work for participants? | Participants and delivery partners | Reach, experience, outcomes | `program-evaluation` |
| Community consultation | Sector module | What local priorities should inform a decision? | Residents or community groups | Needs, impacts, trade-offs | `community-consultation` |
| Event feedback | Sector module | What should organizers keep or change? | Attendees, speakers, staff | Access, experience, logistics | `event-feedback` |
| Personal reflection and wellbeing | Sector module | What support or next step would a person choose? | An individual | Self-defined needs, preferences, next step | `personal-wellbeing-reflection` |

Full packages have complete decision-oriented question examples below. Sector modules are shorter patterns and need the same purpose, respondent, timeframe, privacy, method-fit and review decisions established in the common operating procedure. The table is a routing aid, not a claim that a package is validated for a population or outcome.

Before drafting, confirm the decision and accountable owner, intended population and recruitment, response use and audience, timeframe, reporting and retention facts, and accessibility or sensitivity needs. Ask about critical unknowns or mark them as assumptions; do not invent them.

### Distinguish adjacent purposes

- Choose **product discovery** for a real user problem or unmet need; **service improvement** for friction in a defined service journey; and **customer success** for progress toward a goal the provider and customer already agreed.
- Choose **employee onboarding** for a bounded early-tenure period; **workplace process** for a workflow or handoff regardless of tenure. Neither is an employee climate or recurring workforce pulse instrument; survee has no dedicated validated climate package.
- Choose **industrial operations** for recurring production and maintenance flow in a defined work area and period; choose **workplace process** for workflows in any sector. Do not use an industrial-operations questionnaire as the site's live shift log, hazard/incident reporting route, safety investigation, compliance attestation, or individual performance review. survee links answers to participant records, so hosts must not promise anonymity and should avoid small-group reporting that could identify workers.
- Choose **personal planning** for a practical self-selected goal; **personal wellbeing reflection** for optional present-focused reflection. Neither supports screening, diagnosis, therapy, or crisis response.
- Choose **program evaluation** only when an evaluation owner has defined the evaluation question, design, indicators, and evidence sources. It is not interchangeable with a general experience-feedback package.
- Choose **health service experience** only for local, non-clinical service feedback. It is not a substitute for a field-tested patient-experience measure such as a relevant CAHPS instrument.
- For family or unpaid carers' own experience accessing support services, adapt the bounded **carer support-service discovery** module under health service experience or program evaluation. Keep the question focused on service access, information, respite, navigation, or practical support the host can act on. This is not a clinical, functional-needs, eligibility, safeguarding, or care-plan assessment; do not ask carers to disclose another person's diagnosis or detailed care needs. Identify a named service owner and a separately monitored route for urgent or safeguarding concerns before collection.

When two purposes still fit, preserve the ambiguity in the review and ask which decision the host needs to inform. Do not treat a larger package as automatically more comprehensive or more valid.

## Sampling and reporting plan

For each interview, add a short sample plan to the review record before drafting:

- **Purpose and unit:** state whether the goal is qualitative discovery, service feedback, a census of a defined group, or a population estimate; name the target population and unit of response.
- **Frame and recruitment:** name the list, panel, community, service or open channel used to reach people. Label the selection method accurately as probability-based, purposive, quota, convenience, opt-in/open invite, or another described method. Do not call an invitation to all known contacts a population census unless the frame covers the full target population and response is complete.
- **Coverage and eligibility:** state who could be missed or unable to participate, inclusion/exclusion rules, eligibility checks, any quotas or oversampling, and how partial, duplicate, or ineligible submissions will be handled if known.
- **Collection:** state mode, language(s), field dates, and relevant accessibility or administration conditions. If estimating a population quantity, document the sampling frame, selection probabilities, nonresponse treatment, weighting, estimator, and qualified methodology review before fielding.

Choose sampling that fits the purpose. Purposive, convenience, and open/opt-in samples can be useful for exploration, usability learning, and local service improvement. Their respondent counts describe who answered; without a defensible design they do not establish representativeness, population estimates, or a conventional margin of sampling error. A larger non-probability sample does not by itself remove selection or nonresponse bias. Do not present self-selected results as the views of a wider population.

When reporting results, include a compact methods record alongside findings:

- Questionnaire version and exact question wording and response options.
- Question order, relevant preceding instructions/questions, section context, and the routing/display conditions under which each result was collected.
- Target population and unit, frame or source, selection/recruitment method, eligibility, quotas, collection mode/language(s), and field dates.
- Target completion time and observed range/median when measured, with measurement method and participant context; otherwise mark timing unmeasured.
- Invitations, known eligible contacts, starts, submitted and partial responses, exclusions, and disposition or response rates only when the needed denominator is available and defined.
- Per-question valid n and missing/no-answer counts; weighting and estimation method if used, with the assumptions and reviewer.
- Findings separated from interpretation, plus who was not represented, nonresponse/coverage limits, and other material uncertainty.
- For feedback or consultation, the planned report-back owner, timing, channel, decision boundary, privacy safeguards, and disposition of actions; state why this is not applicable for self-reflection or another use without participant-facing findings.
- Respondent notice version and any AI role/model/prompt details and human oversight relevant to the work; separate synthetic checks from human responses.

Do not invent sample or response counts. If the design does not support population inference, label results as feedback or exploratory evidence from participants and do not report a conventional margin of error or claim representativeness.

## Additional sector modules

Use these as narrowly scoped modules within a package. They are prompts for an interview, not a validated assessment, audit, incident channel, or professional service.

### Candidate experience

**Use for:** improving application and interview steps, not ranking candidates or deciding who should be hired.

- Clarity (`scale`): “How clear were the next steps in the [stage] process?” Label both ends and include “not applicable” if some candidates did not reach that stage.
- Access (`longtext`): “Was there anything that made it difficult to take part in the process?”
- Communication (`single`): “When did you receive an update?” Use time ranges that match the actual process, plus “I did not receive an update”.
- Improvement (`longtext`): “What is one change that would make the process clearer or easier to take part in?”

**Review:** collect no protected attributes or unnecessary employment history. Keep this feedback separate from selection records and do not use it to rank or select applicants. If the host intends any selection use, stop and obtain qualified, jurisdiction-specific assessment and legal review; this package does not establish job-related validity or fairness.

### Employee onboarding and workplace experience

**Use for:** finding changes to onboarding, tools, role clarity, or team processes.

- Access (`single` then conditional `multi`): “Were the tools or resources you needed ready?” If yes, ask “Which ones were ready?” Use actual resources in the checkbox list. If instead offering “None of these” in the same `multi` question, mark its option value in `exclusiveOptions` so it cannot combine with resources.
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
- Conditions (`multi`): “Which conditions may have contributed?” Use “not sure” only where it fits the respondent's role; if it means they cannot identify any factor, declare that option in `exclusiveOptions`. If someone may know some factors but be uncertain about others, word options to capture that distinction instead of forcing a false either/or.
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

### Program evaluation

**Use for:** learning whether a defined service, grant, or initiative reached its intended participants, how it was delivered, and what outcomes merit further evaluation. Start from the program logic or theory of change. Define the population, period, intended use, and whether questions concern implementation/reach, participant experience, or outcomes. Map each question to an indicator and credible evidence source with the evaluation owner.

- Participation (`single`): “Which activities did you take part in?” Use a checkbox if multiple activities are possible.
- Access (`longtext`): “What made it easier or harder to take part?”
- Experience (`scale`): “How well did the activity meet the need you came with?” State the audience and timeframe.
- Priority (`multi`): “Which changes should be considered next?” Avoid presenting the result as representative unless the sampling method supports that claim.

**Review:** self-report can inform an evaluation but does not by itself establish representativeness, a counterfactual, impact, or causal attribution. Distinguish implementation and participant experience from outcomes, document the evaluation design and limitations, and get domain review for outcome measures.

### Community consultation

**Use for:** gathering community perspectives on a specific decision while options are still open. Name the decision-maker, decision window, affected population, who is invited, the participation method (open/opt-in, targeted, sampled, or deliberative), how input will be weighed, and when participants will hear what happened.

- Place (`select`): “Which area or community do you live, work, or spend time in?” Offer only categories needed for analysis and a skip option where appropriate.
- Impact (`longtext`): “How could [proposal] affect you or your community?”
- Trade-off (`multi`): “Which considerations should decision-makers weigh?” Include a balanced set grounded in the proposal and allow an unlisted response if useful.
- Priority (`longtext`): “What should decision-makers consider before deciding?”

**Review:** use accessible participation routes; identify groups not reached. Do not describe voluntary responses as representative unless recruitment and sampling support that claim. Explain how input will be analyzed and reported back, including disagreement and minority views. Consultation informs a decision; it is not a vote or a promise that every suggestion will be adopted.

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

### Bounded organizational-change module

Use this module when a named change is affecting a defined task and the owner needs practical implementation feedback. Identify the change, phase, task, respondent groups with direct experience, and what is still open to adjustment. Ask about the respondent's own work context; do not turn responses into a readiness, engagement, sentiment, adoption, or manager score, and do not infer productivity or change success from self-report alone.

- Task change (`longtext`): “Since [change/phase] began on [date], what, if anything, changed in how you do [specific task]?”
- Clarity (`scale`, optional): “How clear are the steps for completing [specific task] under the current process?” Label both ends, state the reference phase, and allow a skip when the respondent has not done the task.
- Practical barrier (`multi`, optional): “What, if anything, has made it harder to complete [specific task] during this phase?” Use locally grounded categories and include a valid no-barrier or not-applicable path only where those answers are meaningful.
- Support need (`multi`, optional): “What would make the next step clearer or easier for your work?” Keep choices actionable, such as instructions, access, timing, tools, or a named contact; do not promise that each request will be met.
- Adjustment (`longtext`, optional): “What one adjustment should the change owner consider before the next phase?”

**Review:** The owner must define the decision window, who can see person-linked answers, how small groups will be protected, and how workers will hear what changed or why a suggestion was not adopted. Sample affected roles and locations without collecting identifying combinations unless necessary. Include a separately monitored route for urgent safety or employment concerns; survee does not collect or escalate them. This is process feedback, not formal change-control, consultation consent, an employment assessment, or evidence that the change caused an outcome. GAO reform guidance and the CDC evaluation framework inform participation and follow-up planning, not this question set's validity. Avoid requests to identify colleagues or attribute blame. Be explicit about whether responses are identifiable; do not promise anonymity. If decisions may affect employment, seek relevant professional review and do not use the questionnaire as an automated selection tool.

## Industrial operations

**Use for:** finding recurring friction in a defined production, maintenance, or operations workflow. Set a recent reference period and name the improvement owner before inviting workers. Keep the questionnaire separate from controlled shift-handover logs and safety-critical communications; HSE guidance treats shift handover as an operational safety control, including at operations/maintenance interfaces.

- Work area (`select`): “Which broad work area did you work in during [period]?” Use only categories needed to understand the process; avoid exact asset or team combinations that could identify a person.
- Delay (`scale`): “During [period], how often did work wait because an input, decision, material, tool, or handoff was unavailable?” Label both ends and allow the person to leave it unanswered when it does not apply.
- Constraint (`multi`): “Which factors most often constrained the flow of this work?” Use categories grounded in the site (for example, schedule changes, materials, equipment availability, information, approvals, rework, or maintenance coordination). Treat “none” as exclusive when offered.
- Routine coordination (`scale`, routed follow-up): “How reliably did operations and maintenance coordinate planned work and return-to-service expectations?” Show only to respondents who selected maintenance coordination as a constraint. Do not ask whether an isolation, permit, safeguard, or other safety control was followed.
- Improvement (`longtext`): “What recurring process condition should the improvement team examine?” Ask for process context, not names, injury or illness details, active hazards, near misses, security-sensitive information, or blame.
- Repeated coordination points (`repeat`, optional): only when the improvement decision requires separate examples, ask about up to a small number of recent routine coordination delays, with a short common set such as broad process stage and delay category. Say whether to select the most recent examples if there are more than the cap. Do not collect live status, safety events, names, permits, isolation details, or evidence about individual worker performance; replace this item with one `longtext` prompt when examples do not need structured comparison.
- Change (`longtext`, optional): “What small change could reduce this friction?” Tell respondents who will review suggestions and how the host will report back on actions.

### Frontline resource-efficiency discovery module

Use when operators or process partners can surface possible energy, water, material-use, or waste opportunities for a qualified team to investigate. Define the production process and recent reference period, name an accountable operations and resource-efficiency owner, and explain how worker suggestions will be reviewed and reported back. Treat responses as observations and investigation leads, never as measured performance or authorization to change standard work.

- Observation (`longtext`, optional): “During [period], what, if anything, did you notice about energy, water, material use, or waste during [defined process] that the resource-efficiency team should examine?” Ask respondents to describe conditions they observed; do not solicit unsupported quantities, savings, emissions, costs, or personal names.
- Area (`multi`, optional): “Which area might this observation relate to?” Use only locally meaningful categories, such as energy, water, material use, waste, or unsure; make `unsure` exclusive if included.
- Operating context (`longtext`, optional): “What operating conditions would the team need to understand before considering a change?” Prompt for quality, reliability, output, workload, timing, and safety constraints where relevant; do not ask respondents to authorize or prescribe safety-critical changes.
- Investigation priority (`single`, optional): “Which observation should the team investigate first?” Offer a short, balanced list derived from the brief, plus a meaningful “not sure” or “none” path when appropriate. Do not treat this as a measured impact ranking.

**Review:** The host must route suggestions to qualified operations and energy/resource specialists and use its separate engineering, safety, environmental, and management-of-change processes to measure baselines, assess impacts, and authorize any changes. Do not infer savings, emissions reductions, regulatory compliance, or causal impact from questionnaire responses; do not use incentives that reward unsupported estimates. Protect workers from identification through asset, shift, product, or work-area combinations, and keep urgent hazards in the site's monitored reporting route. [ENERGY STAR](https://www.energystar.gov/industrial_plants/improve/plant-energy-auditing) distinguishes employee opportunity discovery from plant assessments; [EPA's Lean & Energy toolkit](https://www.epa.gov/sustainability/lean-energy-toolkit-executive-summary) connects resource efficiency with quality and operational value; [ISO 50006:2023](https://www.iso.org/standard/79367.html) addresses evaluating energy performance with indicators and baselines. These sources inform boundaries and do not validate this question set.

**Review:** This package is for non-decisional process learning, not live handover, hazard/near-miss/incident reporting, safety investigation, energy/resource audit or savings verification, compliance certification, or worker performance appraisal. Put the site's monitored urgent hazard and emergency routes in the respondent notice; urgent concerns must use those routes and must not wait for survey review. OSHA says worker-participation processes should provide reporting and follow-up without discouraging accurate reports. Do not imply that survee is anonymous: hosts can see person-level answers. Explain access and use, minimize small-group breakdowns, avoid collecting names or sensitive operational details, consider worker language/access needs, and close the loop with the workforce. Obtain the host's safety, privacy, resource-efficiency and workforce review before fielding.

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
- Access (`multi`): “Which formats help you take part?” Supply formats actually available and “other” as applicable. If offering “None of these”, mark its option value in `exclusiveOptions`; custom controls must implement and test the same exclusive behavior.
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

### Carer support-service discovery (bounded module)

**Use for:** understanding family or unpaid carers' experience accessing a named support service or program, so its owner can improve service access, information, respite, navigation, or practical support. Select only questions that map to a documented service decision. If the primary question is whether a defined program reached intended participants or achieved stated outcomes, use the program-evaluation package and its evaluation owner's design.

- Service and timeframe (`short`): “Which [named support service] did you use, and when did you most recently use it?” Avoid collecting a care recipient's name or identifying details.
- Access (`longtext`): “What, if anything, made it difficult for you to find or access [service]?”
- Information (`longtext`): “What information would have helped you decide whether [service] was right for you?”
- Practical support (`multi`): “Which types of support, if any, would be useful to hear more about?” List only support types actually available; allow “not sure” and “prefer not to say” as appropriate.
- Improvement (`longtext`): “What is one change that would make it easier for carers to use [service]?”

**Review:** This module gathers service feedback, not a comprehensive caregiver assessment. The Administration for Community Living's caregiver assessment resources emphasize an assessment process tied to support planning; survee must not imply it performs that function. Minimize information about the care recipient, make sensitive details optional, and assess privacy and accessibility with the responsible owners. The host must name who reviews responses, what support action can follow, and a separately monitored urgent/safeguarding route; never imply that this questionnaire monitors immediate needs. For formal caregiver assessment, eligibility, clinical advice, safeguarding, or care planning, use the responsible qualified service and its approved process.

## Personal planning

**Use for:** an individual choosing a practical next step. Let the person define the scope; avoid prescriptive recommendations.

- Goal (`longtext`): “What would you like to be different by [timeframe]?”
- Importance (`longtext`): “Why does that matter to you?”
- Support (`longtext`): “What resources or support could help?”
- Next step (`longtext`): “What is one step you might take next?”
- Optional repeated goals (`repeat`, only when the person wants to compare several): allow a small number of self-selected goals with fields such as goal text, time horizon, and a possible next step. Keep every field optional, offer a plain skip, do not infer other people's preferences, and do not present answers as clinical advice or assessment. For one goal, use the fixed questions above; for an evolving account, use optional text instead.

**Review:** Keep personal disclosures optional and avoid collecting detailed finances, health information or information about other people without a clear need. Do not frame the result as professional advice or a crisis service.

### Optional shared-decision preparation module

Use this only as a preparation aid for one respondent to organize their own priorities, known options, questions, and uncertainties before a conversation with a qualified professional or another person. Shared decision making remains a conversation involving the person and the appropriately qualified decision partner; survee does not compare or recommend clinical options.

- What matters to you as you think about this decision? (`longtext`, optional)
- What options have you heard about so far? (`longtext`, optional; “I don't know yet” is a valid response)
- What would you like to ask or discuss with [qualified professional/person]? (`longtext`, optional)
- What are you unsure about, or would you prefer to leave for that conversation? (`longtext`, optional)

Keep responses attributed to the respondent only. Do not ask them to speak for a partner or household, infer another person's preference or consent, rank treatment options, or make the respondent commit to a choice. Avoid sensitive clinical details that are not necessary for this preparation purpose, and state only verified privacy and sharing facts. The host should identify who can answer clinical questions; urgent needs must use a separately monitored route. This module is not a decision aid, validated instrument, clinical recommendation, or substitute for discussion with a qualified professional. Test it with intended respondents and review it with the responsible domain and privacy owners before use.

## Reusable agent brief

> Read the survee format, playbook, design system and interview packages. Use the [package] package for [decision], for [respondents], about [scope and timeframe]. The host will use responses to [purpose]. Work within [target completion time and other constraints]. Adapt examples rather than assuming all are needed. Before drafting, map each decision to the evidence needed and each question to a clear construct; identify assumptions, excluded respondents, sensitive data, host-approved respondent notice and retention facts, and any consequential use. Specify the target population, unit, sample frame/source, recruitment and selection method, who may be missed, eligibility, collection mode/language, and whether the purpose is qualitative learning or population estimation; state assumptions when details are unavailable. Ask one concise batch of essential questions if critical facts are missing; otherwise state reasonable assumptions. Propose neutral, self-contained questions and balanced response options; use routing only where it changes applicability and disclose retained inactive answers. Do not invent consent, anonymity, a monitored response process, certification, scoring, or an automated decision. Produce one complete survee HTML file plus a review record with the decision-to-question map, sample and host-run field-monitoring plans, respondent notice/ethics dispositions, AI role and human oversight if applicable, question-content pretest evidence, rendered/accessibility checks, observed burden when measured, sampling/reporting limits, and untested aspects. Preserve existing IDs and option values when revising a live questionnaire.

## Evidence and further reading

- The [CDC cognitive interviewing guide](https://www.cdc.gov/nchs/ccqder/question-evaluation/cognitive-interviewing.html) describes testing how respondents comprehend and answer survey questions. Cognitive testing complements, rather than replaces, an end-to-end usability session.
- The US Administration for Community Living's [National Strategy to Support Family Caregivers](https://acl.gov/CaregiverStrategy) and [caregiver outreach and assessment resources](https://acl.gov/ncsc/outreach-assessment) provide context for caregiver support and assessment. They are not ready-made survee instruments; use a qualified local service owner to define and review any support-service questions.
- The US Census Bureau's [Statistical Quality Standard A2](https://www.census.gov/about/policies/quality/standards/standarda2.html) and [Appendix A2](https://www.census.gov/about/policies/quality/standards/appendixa2.html) distinguish respondent pretesting from expert review and call for functional verification and documentation. Apply the standard in its own federal context; use it here as a methods reference.
- The Australian Bureau of Statistics [Forms Design Standards](https://www.abs.gov.au/statistics/standards/abs-forms-design-standards/2023) combine survey research and practical advice on question development, respondent burden, visual design, and testing. They are a strong Australian reference; their standard wording and examples do not automatically fit every survee use case.
- The UK Government Analysis Function's [Questionnaire Design Guidance](https://analysisfunction.civilservice.gov.uk/policy-store/questionnaire-design-guidance/) and [Survey Development Toolkit](https://analysisfunction.civilservice.gov.uk/policy-store/survey-development-toolkit/) describe respondent-centred discovery, alpha/beta/live phases, question pretesting, and the difference between cognitive and usability testing. Adapt their methods to the host's context and resources.
- W3C guidance covers [form labels](https://www.w3.org/WAI/tutorials/forms/labels/) and [instructions](https://www.w3.org/WAI/tutorials/forms/instructions/). Test the actual controls and interaction states, not just the presence of labels in a draft.
- The UK ICO's [purpose limitation](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/purpose-limitation/) and [data minimisation](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/data-minimisation/) guidance illustrates the relationship between a stated purpose and what data is needed. Applicable obligations depend on jurisdiction and context.
- The Australian OAIC's [APP 3 guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-3-app-3-collection-of-solicited-personal-information) explains Australian Privacy Principle collection limits, including reasonable necessity and data minimisation; its application depends on the organisation and context. OAIC's [Privacy by Design guidance](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/privacy-impact-assessments/privacy-by-design) recommends identifying information flows and privacy risks early and revisiting them as a project changes.
- The OAIC's [guide to privacy impact assessments](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/privacy-impact-assessments/guide-to-undertaking-privacy-impact-assessments) describes proportionate assessment of information flows and privacy impacts. Applicable duties depend on jurisdiction and organisation.
- The [AHRQ shared decision making overview](https://www.ahrq.gov/sdm/about/index.html) and [NHS England shared decision making guidance](https://www.england.nhs.uk/personalisedcare/shared-decision-making/about/) describe a collaborative decision process that incorporates the person's preferences and the expertise of a qualified care team. survee's preparation module only helps a respondent organize their own questions and preferences; it does not perform shared decision making or recommend an option.
- AHRQ provides [plain-language communication guidance](https://www.ahrq.gov/health-literacy/improve/precautions/tool4.html) for health settings. Adapt terminology to the intended audience.
- The [CDC Program Evaluation Framework, 2024](https://www.cdc.gov/mmwr/volumes/73/rr/rr7306a1.htm) emphasizes context, collaborative engagement, credible evidence, and use of findings. It is a framework, not a plug-in questionnaire.
- The [CDC Framework Action Guide: Act on Findings](https://www.cdc.gov/evaluation/php/evaluation-framework-action-guide/step-6-act-on-findings.html) recommends planning use, dissemination, and actionable reporting of evaluation findings. This informs a host report-back plan; survee itself does not deliver it.
- The [U.S. Government Accountability Office's 2025 reform report](https://files.gao.gov/reports/GAO-25-106675/index.html) discusses employee inclusion and two-way communication during reform. This supports the industrial package boundary but does not validate a survee questionnaire.
- The [OECD Guidelines for Citizen Participation Processes](https://www.oecd.org/en/publications/oecd-guidelines-for-citizen-participation-processes_f765caf6-en.html) cover defining the policy question, participant selection, methods, and feedback to participants. Adapt to local public-sector and community context.
- [AAPOR's disclosure standards](https://aapor.org/standards-and-ethics/disclosure-standards/) explain the information needed to assess survey methods and findings, including population, sampling, collection mode, field dates, and response disposition. Report only what the host can substantiate.
- The [AAPOR Responsible AI Integration in Survey Research report (2026)](https://aapor.org/wp-content/uploads/2026/05/Responsible-AI-Integration-In-Survey-Research.pdf) recommends human oversight, documenting AI's role and validation, and distinguishing synthetic testing from human respondent evidence. survee does not log off-platform agent model or prompt details, so the accountable team must retain those in its review record.
- The U.S. HHS [OHRP guide to IRB review](https://www.hhs.gov/ohrp/education-and-outreach/online-education/human-research-protection-training/lesson-4-irb-review-of-research/index.html) explains the role of the responsible human-research protection program/IRB. survee agents should route possible determinations to that office, not make them.
- The ICO's [DPIA guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/how-do-we-do-a-dpia/) provides a jurisdiction-specific model for documenting data flows, purpose, retention, and risk; apply local law and accountable privacy review.
- The ABS [sample design guide](https://www.abs.gov.au/websitedbs/d3310114.nsf/home/Basic%2BSurvey%2BDesign%2B-%2BSample%2BDesign) explains fit-for-purpose probability and non-probability designs, and why non-probability samples do not support ordinary population precision claims. It also notes that increasing sample size does not remove nonresponse bias.
- [AAPOR's Transparency Initiative](https://aapor.org/standards-and-ethics/transparency-initiative/) details disclosures about the population/frame, recruitment and eligibility, mode and language, dates, sample dispositions, weighting, and inference limits.
- AAPOR [condemns presenting a self-selected poll as legitimate general research](https://aapor.org/standards-and-ethics/condemned-survey-practices/); opt-in results should be reported within their actual sample limits.
- [AAPOR's best practices](https://aapor.org/standards-and-ethics/best-practices/) describe quality review across the survey lifecycle, including pretesting with people like the target population and transparent reporting. They inform the evidence separation above; survee's risk classes and release blocks are product policy.
- For employment-related work, [OPM structured interview guidance](https://www.opm.gov/policy-data-oversight/assessment-and-selection/structured-interviews/) and the [EEOC employment test guidance](https://www.eeoc.gov/laws/guidance/employment-tests-and-selection-procedures) distinguish structured selection methods and consequential assessment from experience research. survee packages do not validate hiring assessments.
- For safety learning, [OSHA worker participation guidance](https://www.osha.gov/safety-management/worker-participation) emphasizes worker involvement and reporting pathways. A survee questionnaire is not an emergency or statutory reporting channel.
- For industrial operations, the UK's [HSE shift-handover guidance](https://www.hse.gov.uk/humanfactors/topics/shift-handover.htm) covers communication at shift changes and operations/maintenance interfaces; it is a reminder to keep a questionnaire separate from the controlled live handover process. HSE's [consultation tips](https://www.hse.gov.uk/involvement/consulttips/) address consulting workers across shift patterns. OSHA's [worker participation guidance](https://www.osha.gov/safety-management/worker-participation) calls for reporting pathways, worker involvement, and follow-up without discouraging accurate hazard or injury reports. These are design references, not a substitute for the employer's procedures or jurisdiction-specific review.
