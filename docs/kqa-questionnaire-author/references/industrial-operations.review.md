# Industrial operations example review

**Status: illustrative draft only — NOT validated or ready to field.** This example adapts the `industrial-operations` package and its bounded frontline resource-efficiency discovery module from `kqa-interview-packages/11`. It demonstrates KQA's optional one-question-at-a-time flow. A clean static check verifies format and markup only; no respondent, usability, accessibility, safety, privacy, or resource-efficiency review has been performed.

## Scope and assumptions

- **Decision:** Identify recurring workflow friction and worker-observed resource-efficiency opportunities for qualified operations and resource specialists to investigate. The questionnaire does not measure performance, establish savings, authorize process changes, or decide anything about an individual.
- **Process and period:** `[defined process]` and `[recent reference period]` are placeholders. The host must replace them consistently with a bounded process and recall period before use.
- **Respondents and unit:** Assumed operators, maintenance staff, planners, or process partners with direct recent experience. One respondent describes their own experience; they should not report on another person's performance.
- **Use and risk class:** Assumed non-decisional operational learning. The accountable host must verify that responses will not be used for employment, performance, compliance, safety-investigation, or individual decisions. Any such proposed use is outside this package and requires a separately governed method.
- **Interaction:** `guided-question` shows one eligible root question per step, preserves authored order, and uses the regular answer review. It was chosen here to keep each optional prompt in a focused step and to demonstrate a routed follow-up. This increases navigation actions; it is a design hypothesis, not evidence of improved usability. Compare against the full-page flow with intended workers before selecting a field version.
- **Burden:** Seven optional questions, with two routed follow-ups. **Target completion time: host to set before testing. Observed time: unmeasured.** Do not publish a time estimate until observed with intended respondents.
- **Analysis boundary:** Descriptive local learning only. Responses are person-linked in KQA. Do not promise anonymity or infer representative worker or site-level prevalence from opt-in responses.

## Decision-to-question map

| Decision or learning need | Question IDs | Intended interpretation | Boundary |
|---|---|---|---|
| Describe the broad work context represented | `work-area` | Broad self-described area for grouping only when counts and disclosure controls support it. | Do not combine area with shift, asset, product, or team details to identify a worker. |
| Identify recurring workflow conditions worth investigating | `constraints`, `coordination`, `flow-example` | Optional descriptions of selected constraints, a routine coordination rating, and one process example. | Not a safety-control audit, handover, incident account, or measure of an individual's performance. `coordination` appears only when maintenance coordination is selected. |
| Identify possible resource-efficiency observations for qualified review | `resource-observed`, `resource-detail`, `improvement` | Whether the respondent noticed a possible opportunity, their optional general description, and an optional investigation suggestion. | Not an estimate of savings, emissions, costs, output, compliance, or causal impact; not authority to change standard work. `resource-detail` appears only after “Yes.” |

### Route and retained-answer plan

| Source answer | Expected eligible questions | Route behavior and interpretation |
|---|---|---|
| `constraints` does not include `maintenance-coordination`, is blank, or is exclusive `none`/`unsure` | `coordination` is inactive; all other questions remain eligible. | Any saved `coordination` value is retained while inactive and may return if the route becomes eligible again. |
| `constraints` includes `maintenance-coordination` | `coordination` becomes eligible. | The scale is optional and concerns routine timing/return-to-service coordination only. It does not assess safeguards or permit compliance. |
| `resource-observed` is `yes` | `resource-detail` becomes eligible. | Optional general observation and operating context, without estimates or identifiers. |
| `resource-observed` is `no`, `unsure`, or unanswered | `resource-detail` is inactive. | Any prior detail remains saved while hidden and may return if “Yes” is selected later. |

Before fielding, test each route, route changes in both directions, restoration and clearing of retained values, the exclusive checkbox behavior, optional skips, one-question navigation, answer review, progress, saving, submission, and export treatment. The static checker does not run this matrix.

## Sample and field plan placeholders

- **Target population and unit:** `[define eligible roles, work areas, period, and whether contractors or partners are in scope]`; one worker describing their own recent experience.
- **Frame/source:** `[name the verified workforce or process-partner invitation source and coverage]`.
- **Recruitment and selection:** `[describe channel, timing, selection method, whether participation is voluntary, and any compensation]`. State whether the sample is probability-based, purposive, convenience, or opt-in; do not imply representativeness from an open link.
- **Coverage and exclusions:** `[identify workers without reliable access, languages, shifts, locations, or roles likely to be missed and any accessible alternatives]`.
- **Collection mode/language:** `[private-link setup, offered languages, approved support, and accessible completion alternative]`.
- **Collection dates:** `[start/end dates]`.
- **Target and observed completion time:** `[set target before test]`; observed time is unmeasured until tested with intended workers.
- **Monitoring and stop criteria:** `[named host owner, review cadence, available manual disposition checks, anomaly process, urgent/safety escalation route, and stop/extend criteria]`. KQA does not provide live response notifications, item-display telemetry, or monitored hazard escalation.
- **Analysis and report-back:** `[qualified analyst, intended audience, small-cell suppression, free-text handling, host owner, report-back date/channel, and how suggestions will be dispositioned]`. Separate worker observations from measured baselines and approved engineering estimates.

## Respondent notice, privacy and ownership

Replace the visible notice placeholder before any invitation with a host-approved notice that states:

- **Purpose and decision owner:** `[confirmed process-learning purpose and named accountable owner]`.
- **Access:** `[who can view person-linked responses and receive exports]`.
- **Use and follow-up:** `[specific analysis, reporting, and report-back plan; whether individual follow-up is or is not expected]`.
- **Retention/deletion:** `[verified retention period or deletion expectation and responsible data owner]`.
- **Contact and alternatives:** `[privacy/workforce contact, accessible participation alternative, and the site's monitored urgent/safety reporting route]`.
- **Review and approval:** `[host, workforce, privacy, safety, accessibility, resource-efficiency, and methodology reviewers as relevant; role, disposition, and date]`.

Do not collect exact asset, shift, team, product, customer, security, health, or incident details. Combinations of broad categories and free text can still identify a worker at a small site. The host must assess workforce power imbalance, appropriate consultation, local privacy and employment obligations, and whether ethics review is needed. The agent cannot make these determinations. The responsible engineering and safety processes—not questionnaire responses—must assess and approve any operational change.

## AI-use and evidence record

- **AI involvement:** AI assisted drafting this illustrative HTML and review record. Provider/model snapshot and prompt revision were not recorded for this example. No AI collected responses, generated participant records, coded response data, or produced findings.
- **Human oversight:** No independent industrial, safety, privacy, workforce, methodology, accessibility, or language reviewer has reviewed this draft.
- **Synthetic data:** None used. Do not count synthetic responses as human respondents or as pretest evidence.
- **Disclosure implication:** If AI is later used to recruit, collect or transform responses, generate synthetic records, code/analyze data, or write reported findings, document the task, model/tool and version when known, human validation and limitations, and make the applicable disclosure in the host's research/reporting materials. Follow [AAPOR Responsible AI Integration in Survey Research (2026)](https://aapor.org/announcements/task-force-on-responsible-ai-integration-in-survey-research-report/) and its [Transparency Initiative disclosure elements](https://aapor.org/standards-and-ethics/transparency-initiative/); these are research transparency references, not legal advice.

## Pre-field evidence checklist

The only completed check is the structural one below. All other evidence is **not tested** until a reviewer records method, scope, evidence, limitations, date, and disposition.

- [x] Static KQA checker: passed with 0 errors, 0 warnings, and 0 notes (`npm run check -- docs/examples/industrial-operations.kqa.html --agent`). This does not validate question quality or usability.
- [ ] Replace all bracketed process, period, host, notice, sample, analysis, and review placeholders.
- [ ] Accountable host confirms non-decisional use and approves the respondent notice and field plan.
- [ ] Qualified industrial operations, safety, resource-efficiency, workforce, privacy, and methodology review is completed where applicable.
- [ ] Cognitive pretesting with in-scope workers checks comprehension, recall, judgment, selection, sensitivity, and whether the route disclosures are understood.
- [ ] Separate task-based usability comparison of `guided-question` and `all` records completion, hesitation, navigation burden, route changes, errors, recovery, review, and respondent preference across representative roles and devices.
- [ ] Keyboard-only, screen-reader, zoom/reflow at 360–390 px, target languages, focus behavior, dark mode, and reduced-motion checks are completed by an appropriate reviewer. No accessibility-conformance claim is made here.
- [ ] Route matrix, saved-answer restoration/clearing, checkbox exclusivity/cap, optional skipping, save/restore, answer review, submission/locking, and export behavior are manually verified in the running app.
- [ ] Target time is set and observed timing is recorded with participant context; it is currently unmeasured.
- [ ] Host documents small-group protections, report-back commitments, urgent/safety alternatives, analysis limitations, and unresolved actions before fielding.

## Design sources

- The [ENERGY STAR plant energy-assessment guidance](https://www.energystar.gov/industrial_plants/improve/plant-energy-auditing) distinguishes employee opportunity discovery from a qualified assessment; it does not validate this questionnaire.
- [OSHA worker-participation guidance](https://www.osha.gov/safeandsound/safety-and-health-programs/worker-participation) informs the need to support worker involvement and follow-up without displacing established hazard reporting.
- [AAPOR survey best practices](https://aapor.org/standards-and-ethics/best-practices/) informs low-burden, optional responses and respondent pretesting; it does not establish that this opt-in sample represents a workforce.
