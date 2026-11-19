---
name: kqa-questionnaire-author
description: Plan, write, improve, or review an HTML questionnaire for KQA. Use when an agent needs to turn an interview brief into a KQA-compatible respondent experience, tailor a domain package, improve an existing KQA questionnaire, or prepare a safe version update.
---

# KQA questionnaire author

Create a useful, accessible interview that answers the host's real decision or learning need while respecting respondents' time and privacy. KQA stores answers; it does not score them or determine what action a host should take.

## Load the source of truth

Before authoring, read the current KQA `FORMAT.md` and `AGENT_PLAYBOOK.md`. For live-interview changes or tool permissions, read `MCP.md`. Read `DESIGN_SYSTEM.md` for visual, accessibility, interaction, and usability requirements, then load only the relevant starting points from `INTERVIEW_PACKAGES.md`. If connected to KQA MCP, retrieve `get_design_guidance` for the questionnaire surface and `get_interview_packages`; this skill is workflow guidance, not a replacement for those current references.

Do not invent question types, routing rules, host actions, privacy promises, or quality guarantees. KQA supports `single`, `multi`, `select`, `text`, `longtext`, `number`, `scale`, and `date`; there is no native score or ranking type. Follow the current format for custom controls and bounded choice-based routing.

For bounded checkbox questions, use `maxSelections` only when the decision requires a fixed upper bound, reflect it in respondent help ("Choose up to N"), and treat it separately from requiredness. Custom controls must handle a rejected `KQA.set` result and the `validation` event. Never remove saved choices silently when a live questionnaire's cap is lowered.

## Workflow

1. **Understand the brief.** Identify purpose and intended decision, respondent population, inclusion and exclusion, collection window, topic scope, target completion time, language and accessibility needs, data sensitivity, collection/retention expectations, and accountable owner. Require the host to approve a respondent notice covering purpose, access to identifiable answers, use, retention/deletion expectations, and contact route. If facts are missing, mark them unresolved; material privacy facts block fielding. If human-subjects research may be involved, direct the host to its responsible ethics/HRPP/IRB office for a determination. Ask one consolidated round of essential questions only. If a reasonable assumption lets you proceed, state it and mark it for review. Never invent consent, anonymity, confidentiality, retention, or legal compliance claims.
2. **Make the evidence chain visible.** Draft a compact map from decision or learning need → information required → question(s) → answer form → how answers will be interpreted → owner/action. Add the sample plan in [`INTERVIEW_PACKAGES.md`](../INTERVIEW_PACKAGES.md#sampling-and-reporting-plan): population/unit, frame and recruitment, selection method, groups who may be missed, eligibility, mode/language, and whether the purpose is qualitative learning or population estimation. Flag decisions with no evidence, questions with no purpose, unclear interpretation, and high-consequence use. Do not imply that an interview alone establishes causation or validates an instrument.
3. **Choose a fit-for-purpose package.** Adapt the closest domain package to the actual context and population. Treat package content as prompts, not a validated scale or required wording. For sensitive, employment, health, safety, finance, or other consequential contexts, minimize collection, make optionality explicit, route to qualified review where appropriate, and avoid eliciting unnecessary sensitive detail.
   Before drafting, classify the intended use with the host and apply the [risk-based release gate](../INTERVIEW_PACKAGES.md#risk-based-release-gate). The accountable host owns the classification; agents flag risks but do not certify it. Stop if the questionnaire would make or materially support consequential individual decisions, diagnosis, compliance certification, or incident/emergency reporting.
4. **Design the respondent flow.** Order questions from clear and low burden to more demanding; ask one thing per question, define reference periods, use neutral wording, and make choices distinct and complete enough for the task. Set requiredness only when the host cannot proceed without the answer. Use short, tested routing paths; preserve stable question IDs and option values when revising a live questionnaire. Disclose when answers are retained while their routed question is inactive, as the format requires. KQA announces how many questions routing shows or hides without moving focus. Keep question labels and answer options self-contained for the pre-submit **Check your answers** review; it omits currently inactive questions, explains that their saved answers may reappear, and lets respondents clear a value while retaining its optional note.
5. **Build within KQA's contract.** Start from `template/starter.kqa.html`. Put every question in the manifest and bind controls correctly. Keep scripts, styles, and interactions within the supported sandbox. Use semantic labels, keyboard access, visible focus, understandable errors, mobile layouts, and reduced-motion support. Keep the visual system coherent and brief-grounded; do not trade clarity or accessibility for decoration.
6. **Check and review.** Run `check_questionnaire` or the KQA checker and fix every error and relevant warning. Static checks establish format constraints only. Treat the in-app live check as a programmatic value round-trip smoke test; it does not simulate respondent input, verify routing end to end, test submission/locking, or evaluate accessibility or usability. Manually review the rendered questionnaire across representative viewports, keyboard-only use, routes, empty/error states, and supported assistive technology where available. Use the question-content rubric and cognitive pretest protocol in `get_design_guidance` for relevant questions. For a new or materially changed flow, observe representative users completing realistic tasks; cognitive probes and usability tasks may share a moderated session, but record their evidence separately. Record each evidence area separately as passed, issues found, not tested, or not applicable, with scope, reviewer, limitations, and unresolved actions. Apply the linked risk-based release gate; a checker pass cannot waive a missing required review. Never describe unrun checks as passed.
7. **Apply live changes carefully.** For existing interviews, inspect current HTML, versions, compatibility findings, and stable IDs. Prefer the relevant preview/apply pair; inspect its exact candidate and obtain accountable host review before publishing. The `create_interview` tool immediately creates an open interview after a static checker pass. Do not use it for an unapproved draft or imply that the checker makes it ready for respondents. Publishing a version may require respondents on an older page to reload before they can continue.

## Deliverable and review record

Return the complete HTML file and a concise review record containing:

- Purpose, population, assumptions, and accountable owner.
- Sample plan, including source/frame, recruitment and selection method, coverage gaps, eligibility, collection mode/language, and limits on generalization.
- Decision/evidence/question/interpretation map, including gaps.
- Package adapted and material changes made.
- Target completion time and observed time range/median when measured; otherwise say timing is unmeasured.
- Host-approved respondent notice, privacy/ethics review status, and disposition of unresolved material facts.
- Host-run field-monitoring owner, cadence, available checks, escalation route, and stop criteria; identify that KQA does not provide live respondent monitoring.
- AI role, model/provider and prompt version when known, human oversight and validation, with human and synthetic test counts kept separate.
- Requiredness and routing rationale, plus stable IDs preserved for updates.
- Privacy and sensitive-data considerations; unresolved policy or legal questions.
- Checker result, rendered/accessibility checks, cognitive pretest and usability evidence, each marked **passed**, **issues found**, or **not tested** with scope and limitations.
- If cognitive pretesting occurred, include item/context, participant fit, probe dimensions, observed findings, severity, revision/action, and unresolved issue. If not applicable or not tested, explain why; do not conflate this record with usability findings.
- Material tradeoffs, unresolved risks, and the specific host decision needed before launch.

Use plain language and distinguish observed evidence from interpretation. A passing checker is not a finding that the questionnaire is suitable, accessible in every context, legally compliant, or ready to launch.
