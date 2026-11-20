# Service improvement example review

**Status:** Illustrative example only; **NOT validated and NOT ready to field**. This questionnaire was drafted from package `service-improvement` in `kqa-interview-packages/7`; that version label records the source library at the time and predates the current `kqa-interview-packages/13` guidance. The survee static checker passing establishes markup and manifest consistency only. No respondent pretest, task-based usability test, live interaction test, accessibility audit, or domain review has been performed.

## Scope and assumptions

- **Decision:** Identify general service-journey areas that an accountable service owner may investigate for improvement. Do not use responses to decide an individual's access, eligibility, service priority, employment, care, safety, benefits, finances, or legal status.
- **Service and period:** `[service name]` and `[reference period]` are placeholders. The owner must choose a service journey that respondents can recall and replace both placeholders consistently in the heading, questions, and contextual text. The current example assumes a most-recent interaction in a defined recent period; no actual service or period was supplied.
- **Audience/unit:** Assumed service users who personally experienced the defined service in the reference period; one respondent describing one most-recent interaction. Confirm age, eligibility, proxy responses, language, disability/access needs, and exclusions with the service owner. Do not assume all users are represented by the invite list.
- **Purpose and risk class:** Intended as routine, non-decisional service feedback. The accountable host must confirm this classification. If feedback is used for an individual decision or collects sensitive/regulated material, stop and use the appropriate separately governed process and reviews.
- **Collection design:** Qualitative/local service-improvement learning is assumed, not population estimation. No frame, recruitment channel, selection method, collection window, or reporting plan has been supplied. Do not claim representativeness or a margin of sampling error.
- **Format:** Seven optional items in three sections. Native survee controls and declarative routing are used. There is no score, ranked respondent, service ticket, live alert, or promised individual response.
- **Burden:** Target completion time: `[host-set target]`. **Observed completion time: unmeasured.** Do not present an estimate as measured evidence.

## Decision-to-question map

| Decision or learning need | Question(s) | Intended interpretation | Boundary / caution |
|---|---|---|---|
| Understand what people were trying to do and through which channel | `purpose`, `channel` | Describe the types of interaction represented among respondents; compare patterns only where counts and sample support it. | Categories are generic candidates. Replace or adjust them to match the actual service; do not infer unmet demand among all users from an opt-in sample. |
| Understand whether the service interaction reached its immediate purpose and how easy it felt | `completion`, `ease` | Describe reported completion and the distribution of ease ratings for the described interaction. | These are self-reports, not operational performance measures or causal evidence. Keep scale direction and labels consistent; do not invent a benchmark or composite score. |
| Locate a potentially difficult step and learn what may have contributed | `step`, conditionally eligible `barrier` | Summarize selected steps and code optional, general free-text themes for service-level investigation. | Free text may identify a respondent or third party despite instructions. Redact unnecessary identifiers under the host's approved process; do not treat an answer as a complaint or case record. |
| Gather one possible service-wide improvement | `improvement` | Thematically group suggestions for consideration by the service owner. | Suggestions are not votes, a representative priority ranking, commitments, or proof that a change will work. Report disagreement and sample limitations. |

### Routing and retained-answer review

`barrier` is eligible only when `completion` is `partly` or `no`. It is optional while eligible. If completion changes to `yes` or `unsure`, `barrier` becomes inactive; any earlier value is retained, excluded from current eligible-question progress and current-rule analysis, and may reappear if the answer changes back. The page discloses this behavior, and respondents can inspect and clear retained answers in survee's pre-submit answer review.

| `completion` answer | Expected eligible questions | Required while eligible | Progress contribution | Review/export interpretation |
|---|---|---|---|---|
| `yes` | `purpose`, `channel`, `completion`, `ease`, `step`, `improvement` | None | Answered eligible items only | `barrier` inactive; any prior value retained and marked inactive in current-version output. |
| `partly` | All seven, including `barrier` | None | Answered eligible items only | `barrier` eligible; response remains optional. |
| `no` | All seven, including `barrier` | None | Answered eligible items only | `barrier` eligible; response remains optional. |
| `unsure` or unanswered | `purpose`, `channel`, `completion`, `ease`, `step`, `improvement` | None | Answered eligible items only | `barrier` inactive. |

Before fielding, test each route, a change from `partly`/`no` to `yes` or `unsure`, reactivation, saved-answer restoration, ability to inspect/clear the retained value, progress, answer review, and export treatment. The static checker does not run this matrix.

## Sample and field plan placeholders

- **Target population:** `[define eligible service users and relevant subgroups]`
- **Unit:** One person reporting one most-recent interaction; `[confirm whether a proxy may respond]`
- **Frame/source:** `[name the verified invite list, service touchpoint, community, or other source]`
- **Recruitment/selection:** `[describe invitation wording, channel, timing, probability/purposive/convenience/opt-in method, and incentives if any]`
- **Coverage and eligibility:** `[who may be missed or unable to participate; inclusion/exclusion checks; language/access support; duplicate/partial response treatment]`
- **Collection mode/language:** `[KQA private-link setup, languages, accessible alternatives, and relevant administration conditions]`
- **Field dates:** `[start and end date]`
- **Target completion time:** `[set before testing]`; **observed time:** unmeasured until timed with intended respondents.
- **Monitoring:** `[named host owner, review cadence, available manual completion/disposition checks, anomaly/urgent-report route, and stop/extend criteria]`. survee does not provide live response notifications, item-display telemetry, or a monitored request/incident pathway.
- **Analysis/reporting:** `[name analyst and intended audience; define suppression/privacy rules for small groups and free-text handling; describe how results and limitations will be reported back]`. Do not treat opt-in response counts as representative estimates.

## Respondent notice, privacy and accountable owners

Replace the visible notice placeholder with a host-approved, accurate notice before any invitation. Required facts:

- **Purpose:** `[confirmed service-improvement purpose and decision owner]`
- **Access:** `[roles that can view identifiable participant-level answers and any export recipients]`
- **Use:** `[specific analysis, reporting and follow-up uses; state explicitly if there is no individual follow-up]`
- **Retention/deletion:** `[approved retention period or deletion expectation and accountable data owner]`
- **Contact:** `[responsible contact route for questions or data/privacy concerns]`
- **Privacy reviewer / approval date:** `[name or role / date]`
- **Accountable service owner / fielding approval:** `[name or role / date]`
- **Methodology, accessibility and domain reviewers as applicable:** `[names or roles / disposition / date]`

survee answers are associated with participant records and hosts may review person-level responses; this example makes no anonymity promise. Confirm whether an ethics/HRPP/IRB determination is needed for the planned activity. The authoring agent does not determine that. Any unresolved material purpose, access, use, retention or contact fact blocks fielding.

## Pre-field validation checklist

Every item below is **not yet tested** unless evidence and reviewer are added. This example remains illustrative and **NOT validated** until required reviews and tests are completed.

- [x] Static survee checker: passed with 0 errors, 0 warnings, 0 notes (`npm run check -- docs/examples/service-improvement.kqa.html --agent`). This is structural validation only.
- [ ] Replace all `[bracketed placeholders]`; host-approved notice and actual service-specific labels match throughout.
- [ ] Accountable host confirms routine-learning classification and use boundary; no individual decisions, incident reporting, or urgent response uses.
- [ ] Sample frame, selection method, eligibility, coverage gaps, languages, collection dates, analysis audience, and field monitoring plan completed.
- [ ] Respondent notice approved for purpose, identifiable-answer access, use, retention/deletion, and contact; privacy owner records disposition.
- [ ] Target completion time set; observed completion time measured with intended respondents and method recorded (currently unmeasured).
- [ ] Cognitive pretest with in-scope service users covers comprehension, recall, judgment and response selection; findings, severity, revisions, and unresolved issues recorded.
- [ ] End-to-end task sessions with intended users record completion, hesitation, errors, recovery and misunderstanding; results kept separate from cognitive-pretest evidence.
- [ ] Keyboard-only and screen-reader review, focus visibility, labels, zoom/reflow at 360–390 px, dark mode, and reduced-motion behavior checked by an appropriate reviewer. No accessibility conformance claim is made from this checklist.
- [ ] Test every routing row and route change above in survee, including answer restore, hidden-answer inspection and independent clearing, progress, review, and export behavior.
- [ ] Review text for local service fit, translation/language needs, response option coverage, sensitive-data minimization, and analysis/reporting limits.
- [ ] Host records fielding decision, remaining limitations, reviewer identities/roles, dates, and dispositions. A checker pass alone is not approval to field.
