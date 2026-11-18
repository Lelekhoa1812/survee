---
name: kqa-questionnaire-author
description: Plan, write, improve, or review an HTML questionnaire for KQA. Use when an agent needs to turn an interview brief into a KQA-compatible respondent experience, tailor a domain package, improve an existing KQA questionnaire, or prepare a safe version update.
---

# KQA questionnaire author

Create a useful, accessible interview that answers the host's real decision or learning need while respecting respondents' time and privacy. KQA stores answers; it does not score them or determine what action a host should take.

## Load the source of truth

Before authoring, read the current KQA `FORMAT.md` and `AGENT_PLAYBOOK.md`. For live-interview changes or tool permissions, read `MCP.md`. Read `DESIGN_SYSTEM.md` for visual, accessibility, interaction, and usability requirements, then load only the relevant starting points from `INTERVIEW_PACKAGES.md`. If connected to KQA MCP, retrieve `get_design_guidance` for the questionnaire surface and `get_interview_packages`; this skill is workflow guidance, not a replacement for those current references.

Do not invent question types, routing rules, host actions, privacy promises, or quality guarantees. KQA supports `single`, `multi`, `select`, `text`, `longtext`, `number`, `scale`, and `date`; there is no native score or ranking type. Follow the current format for custom controls and bounded choice-based routing.

## Workflow

1. **Understand the brief.** Identify purpose and intended decision, respondent population, inclusion and exclusion, timing, topic scope, burden, language and accessibility needs, data sensitivity, collection/retention expectations, and accountable owner. Ask one consolidated round of essential questions only. If a reasonable assumption lets you proceed, state it and mark it for review. Never invent consent, anonymity, confidentiality, retention, or legal compliance claims.
2. **Make the evidence chain visible.** Draft a compact map from decision or learning need → information required → question(s) → answer form → how answers will be interpreted → owner/action. Flag decisions with no evidence, questions with no purpose, unclear interpretation, and high-consequence use. Do not imply that an interview alone establishes causation or validates an instrument.
3. **Choose a fit-for-purpose package.** Adapt the closest domain package to the actual context and population. Treat package content as prompts, not a validated scale or required wording. For sensitive, employment, health, safety, finance, or other consequential contexts, minimize collection, make optionality explicit, route to qualified review where appropriate, and avoid eliciting unnecessary sensitive detail.
4. **Design the respondent flow.** Order questions from clear and low burden to more demanding; ask one thing per question, define reference periods, use neutral wording, and make choices distinct and complete enough for the task. Set requiredness only when the host cannot proceed without the answer. Use short, tested routing paths; preserve stable question IDs and option values when revising a live questionnaire. Disclose when answers are retained while their routed question is inactive, as the format requires.
5. **Build within KQA's contract.** Start from `template/starter.kqa.html`. Put every question in the manifest and bind controls correctly. Keep scripts, styles, and interactions within the supported sandbox. Use semantic labels, keyboard access, visible focus, understandable errors, mobile layouts, and reduced-motion support. Keep the visual system coherent and brief-grounded; do not trade clarity or accessibility for decoration.
6. **Check and review.** Run `check_questionnaire` or the KQA checker and fix every error and relevant warning. Static checks establish format constraints only. Review the rendered questionnaire across representative viewports, keyboard-only use, routes, empty/error states, and supported assistive technology where available. Cognitively pretest wording with people like the intended respondents; separately run task-based usability sessions for a new or materially changed flow. Record what was and was not tested, findings, limitations, and open risks. Never describe unrun checks as passed.
7. **Apply live changes carefully.** For existing interviews, inspect current HTML, versions, compatibility findings, and stable IDs. Prefer the relevant preview/apply pair; inspect its exact candidate and obtain accountable host review before publishing. The legacy `create_interview` operation immediately creates an open interview after a static checker pass. Do not use it for an unapproved draft or imply that the checker makes it ready for respondents. Publishing a version may require respondents on an older page to reload before they can continue.

## Deliverable and review record

Return the complete HTML file and a concise review record containing:

- Purpose, population, assumptions, and accountable owner.
- Decision/evidence/question/interpretation map, including gaps.
- Package adapted and material changes made.
- Requiredness and routing rationale, plus stable IDs preserved for updates.
- Privacy and sensitive-data considerations; unresolved policy or legal questions.
- Checker result, rendered/accessibility checks, cognitive pretest and usability evidence, each marked **passed**, **issues found**, or **not tested** with scope and limitations.
- Material tradeoffs, unresolved risks, and the specific host decision needed before launch.

Use plain language and distinguish observed evidence from interpretation. A passing checker is not a finding that the questionnaire is suitable, accessible in every context, legally compliant, or ready to launch.
