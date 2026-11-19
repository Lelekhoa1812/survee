# Repeatable records: capability proposal

**Status: research-backed proposal; not implemented.** KQA currently supports a fixed set of manifest questions. This note guides package and questionnaire decisions today and records a possible future feature contract. It is not a promise of a release date or a substitute for respondent testing.

## When repeated records fit

Consider a repeated record only when all of these conditions hold:

- The unit is a clearly defined, distinct instance, such as one recent routine handoff delay or one self-chosen personal goal.
- The same short field set applies to every instance, and keeping instances separate changes the decision or interpretation.
- Respondents can identify instances within a stated, bounded reference period; the count has a justified finite maximum.
- Zero instances is a valid answer where appropriate, and each record can be edited or removed independently.
- The host has a plan to review and export respondent-by-record data without confusing records with independent respondents.

Prefer ordinary fixed questions for one-time constructs or repeated ratings of a known set of topics. Use `multi` for a bounded category list and optional `longtext` for a singular, unusual, or evolving account. A repeat group is a poor fit when the repeated unit, number of instances, or shared fields are unclear, or when structured entry adds more burden than analytic value.

For example, a future process-learning package might ask about a few recent, routine handoff delays with a compact common set of fields. It must not collect live shift status, safety reports, incident investigations, work authorization, evidence of isolation, coworker identities, or material for individual performance or disciplinary decisions. A future personal-planning package might let a respondent record several goals they choose to discuss; it must not infer another person's preferences or turn self-reflection into a clinical assessment. These examples are design hypotheses, not validated instruments.

## Candidate v1 contract

If implemented, the feature should be structurally separate from ordinary question answers. `AnswerValue` currently means a string, number, or string array; those arrays represent checkbox selections or a full ranking. Do not overload it with objects. A group should have stable group and field IDs, one reusable typed field schema, and a hard finite `maxRows`. A response row should have a stable opaque ID and an ordinal used only for display order. V1 should exclude nested groups and cross-row routing.

Requiredness needs explicit meaning: an optional group can contain zero rows; a required group means at least one valid row; a required field is required for each retained row only while that field is eligible. If a respondent has more instances than the cap, the questionnaire must say whether to choose a subset and how to select it; never imply that a capped subset is a complete account. Empty transient rows, removal of populated rows, and a group made ineligible by routing need defined save and recovery behavior. No schema edit or count-bound change may silently delete saved data. Preserve hidden values when routing makes fields inactive, consistent with current KQA behavior.

Persist row-level changes with group, row, and field identity, server-side membership and type validation, version fencing, and bounded payloads. Avoid blind replacement of the entire group array: parallel edits could lose unrelated rows. The authoring checker, answer review, submit validation, version compatibility, and static HTML bridge need an explicit group contract before a runtime implementation begins.

## Respondent interaction and accessibility gates

Use one record card at a time on narrow screens, with a clear “Add another [record]” action, visible count and maximum, and a labeled remove control. Do not require drag-and-drop. If a populated row is removed, provide a clear recovery path and keep focus predictable. Associate errors with both the row and field; announce add/remove/save state to assistive technology. Test keyboard-only operation, screen-reader names and announcements, focus after row changes, 320 CSS-pixel reflow, zoom, touch targets, all supported shell locales, and Arabic right-to-left behavior.

The repeat UI must pass relevant [WCAG 2.2](https://www.w3.org/TR/WCAG22/) AA criteria, including keyboard access, visible focus, labels and instructions, text error identification, and target size. Automated checks are necessary but not sufficient; manually test representative assistive technology and conduct task-based testing with intended respondents. Measure completion time, abandonment, missing fields, corrections, row-count errors, and perceived effort against an equivalent fixed-question or open-text alternative. Do not claim repeated cards reduce burden based on matrix/mobile evidence alone.

## Persistence, export, and analysis

Keep each respondent as the parent record and each repeated row as a child record. JSON should preserve groups and rows explicitly. Tabular exports should offer a normalized child table keyed by response ID, group ID, and stable row ID, with ordinal, field ID, typed value, and relevant missingness. Include a machine-readable schema/codebook with labels, constraints, version, and parent-child keys. Keep row identity distinct from display order and validate export/import round trips, UTF-8 text, and formula-injection handling.

Do not fold repeated rows into current scalar question summaries or cross-tabs by default. Any later row-level summaries need named denominators (people versus rows), eligibility and missingness rules, bounded output, and disclosure review. Raw repeated records remain person-linked and may reveal sensitive information even when aggregate output is provided.

## Compatibility and release evidence

Legacy manifests and answer records without groups must continue to parse unchanged. New group fields need version compatibility rules for added, removed, retyped, and re-bounded fields. Old-page writes must be fenced; removed or inactive data must not disappear without an explicit, reviewable operation. Required tests include group bounds, invalid and duplicate IDs, add/edit/remove recovery, draft refresh, parallel row saves, routing changes, version conflicts, submission, review, import/export round trips, and all existing export formats.

Before field use, test a real prototype with intended respondents across relevant roles, shifts, devices, languages, and access needs. Include independent domain review for industrial examples. Test whether people understand the reference period, whether they should report every instance or a subset, and what to do when they exceed the cap. Measure completion time, abandonment, missing fields, corrections, row-count errors, and perceived effort against an equivalent fixed-question or open-text alternative. Do not claim repeated cards reduce burden based on matrix/mobile evidence alone. KQA remains a fixed authored interview flow; repeated records do not make it a live operational log, adaptive interviewer, longitudinal panel, anonymous channel, or validated scale.

## Evidence and limits

- [ODK repeat groups and form logic](https://docs.getodk.org/form-logic/) document bounded repeat patterns and their collection and analysis costs. This is a mature form-system precedent, not evidence that the proposed KQA interaction is usable.
- ODK's [repeat limits](https://docs.getodk.org/form-repeats/) and [Collect repeat controls](https://docs.getodk.org/collect-filling-forms/) illustrate task-specific caps and respondent-controlled add/remove behavior. Its [repeat logic guidance](https://docs.getodk.org/form-logic/) recommends clear singular labels and cautions that first-time users may not understand a repeat without explanation. These examples support a clear unit label, finite cap, and explicit add/remove controls; their numerical limits should not be copied without task evidence.
- [WAI Forms Tutorial: Grouping Controls](https://www.w3.org/WAI/tutorials/forms/grouping/) recommends semantic `fieldset`/`legend` groupings when controls share a purpose. [WCAG 2.2 Error Identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification) requires detected errors to be identified and described in text, and [WCAG 2.2 Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) covers dynamic updates that should be announced without moving focus. These inform the proposed row and field interaction; they do not validate a KQA implementation.
- [KoboToolbox: Managing repeat groups](https://support.kobotoolbox.org/managing_repeat_groups.html) describes separate repeat exports linked back to parent submissions. [Qualtrics Loop & Merge](https://www.qualtrics.com/support/survey-platform/survey-module/block-options/loop-and-merge/) documents that repeated content can create a large number of columns. These precedents support a normalized child-row export rather than a fixed wide column for each possible row; KQA still needs to test its own formats and import/export round trips.
- [UK HSE shift-handover guidance](https://www.hse.gov.uk/humanfactors/topics/shift-handover.htm) emphasizes two-way communication, incoming-worker information needs, adequate time, and end-user involvement. A questionnaire cannot replace operational handover procedures.
- [OSHA 29 CFR 1910.147](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147) requires continuity of lockout/tagout protection through personnel changes. KQA responses cannot authorize work or verify safe isolation.
- [Frictionless Table Schema](https://specs.frictionlessdata.io/table-schema/) and [W3C Tabular Data Model](https://www.w3.org/TR/tabular-data-model/) provide precedents for typed, constrained, linked tabular exports.
- [Government Analysis Function questionnaire guidance](https://analysisfunction.civilservice.gov.uk/policy-store/questionnaire-design-guidance/) treats burden, accessibility, inclusion, and cognitive testing as design concerns. [Pew mobile survey guidance](https://www.pewresearch.org/2015/06/11/tips-for-creating-web-surveys-on-a-mobile-device/) and [ABS question-structure guidance](https://www.abs.gov.au/statistics/standards/abs-forms-design-standards/2023/general-forms-design-principles-question-structure) warn about grid burden; they do not directly evaluate repeatable record cards.

The public repeatable-record selection benchmark at `/api/docs/repeatable-record-selection-benchmark` now tests when to choose a future repeated group over fixed questions, checkboxes, text, clarification, or out-of-scope handling. Its synthetic labels are provisional and not independently adjudicated. Obtain qualified independent review and a private holdout before using its scores to gate models or releases; public cases cannot validate the interaction or establish enterprise readiness.
