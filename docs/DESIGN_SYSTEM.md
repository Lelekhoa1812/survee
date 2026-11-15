# KQA design system and agent guidance

Version: `kqa-design/3` · reviewed 15 November 2026

This is the product-specific design policy for KQA's host console, respondent questionnaires, and analytics. Agents can retrieve the same principles through the read-only `get_design_guidance` MCP tool. KQA does not include an LLM: connected agents decide how to apply these instructions and should return their rationale and review evidence.

## Product constraints

- Questionnaires are self-contained HTML files rendered in a sandboxed frame. Follow [`FORMAT.md`](FORMAT.md) for allowed controls, runtime behavior, and network restrictions.
- There is no in-app question builder and no scoring. Keep authoring as questionnaire HTML plus the checker; keep answer analysis descriptive.
- Preserve question and option ids when revising a live interview. Run the checker and inspect compatibility findings before creating a new immutable survey version.
- Keep private respondent links and individual answers out of unrelated views, logs, and aggregate analytics.

## Design principles

1. **Make the task obvious.** Lead with the user's task, next action, and current state. Use concrete labels and plain language. Explain consequences before destructive actions.
2. **Fit the intended theme.** Treat the supplied brand, audience, and tone as design constraints. Use a compact set of semantic color, typography, spacing, and shape tokens. Keep contrast and focus legible across themes; never use color alone to communicate meaning.
3. **Keep respondents oriented and in control.** Use clear sections, concise progress, visible save state, and explicit submission consequences. Mark required questions and explain material changes to stored answers.
4. **Ask clear, neutral questions.** Ask one thing at a time in familiar, audience-appropriate language. Avoid leading assumptions, vague terms, double negatives, and items that combine separate ideas. State a reference period for time-bound behavior.
5. **Make response options fit the question.** Make closed options distinct and broad enough to cover reasonable answers. Use balanced scale labels with a consistent direction. Add a neutral point or options like "not applicable", "not sure", "prefer not to answer", and "other" only when they fit the construct. Keep options stable when comparing versions.
6. **Pretest with intended respondents.** For new or high-impact items, ask people like the intended respondents what they think each question means and how they chose an answer. Revise confusing items before fielding when feasible.
7. **Make every interaction operable.** Use semantic controls, programmatic labels, keyboard support, visible focus, and announced status and errors. Meet WCAG 2.2 AA, including the 24 × 24 CSS-pixel minimum target size or a documented exception such as sufficient spacing. Verify keyboard and assistive-technology behavior.
8. **Design for narrow screens and long content.** Reflow at 320 CSS px where WCAG requires it. KQA questionnaires must work from 360 px and should be checked at 390 px. Test long labels, validation, tables, zoom, empty states, and errors.
9. **Use motion to clarify change.** Animate to communicate state or continuity. Keep motion brief, and ensure `prefers-reduced-motion` leaves the interface fully understandable.
10. **Show how every number was made.** State survey version, respondent status scope, time window when used, status-cohort denominator, no-answer count, and valid n. KQA does not track whether conditional questions were shown; do not present cohort counts as item eligibility or no-answer counts as item-level missingness. For ordinal scales show distributions rather than means. For multi-select, make clear that percentages use respondents and can sum above 100%. Separate observed facts from interpretation; do not imply causality, statistical significance, or a score.
11. **Minimize answer exposure.** Aggregate by default. Show person-level answers only for an explicit review task. Do not expose private links or raw answers in analytics, logs, or unrelated exports.

## Review checklist

- Is the task and its outcome clear without color or animation?
- Can a keyboard-only user operate the full flow and see where focus is?
- Are pointer targets at least 24 × 24 CSS px, or covered by a WCAG 2.2 SC 2.5.8 exception such as sufficient spacing?
- Do controls have labels, errors explain recovery, and save/submission status reach assistive technology?
- Have WCAG 2.2 AA contrast and reflow been checked at 320 CSS px, plus KQA's 360/390 px questionnaire widths?
- Have empty, loading, saving, success, error, submitted, long-content, dark-theme, and reduced-motion states been reviewed?
- Does each question ask one clear thing, use neutral wording, and state an appropriate reference period?
- Are closed options distinct and sufficient for reasonable answers, and are scale labels and option ordering intentional?
- Were new or high-impact questions pretested with people like the intended respondents where feasible?
- Are ids stable, required questions visible, and data-impacting survey changes explained?
- For every analytic figure, are survey version, cohort, valid n, no-answer count, and multi-select denominator clear, with KQA's item-eligibility limit stated?
- Are static checker results described only as evidence for the individual checks they cover? They do not judge wording quality, prove visual quality, or establish full WCAG conformance.

## Research basis and limits

- [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/) provides the normative accessibility criteria. KQA targets Level AA.
- [WCAG 2.2 SC 2.5.8: Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) explains the 24 × 24 CSS-pixel minimum and its exceptions.
- [WAI-ARIA Authoring Practices Guide: Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) provides implementation patterns for tab interactions; it is guidance, not a conformance standard.
- [GitHub Primer Product Design](https://primer.style/product/) is a first-party product design-system reference for principles, components, and tokens.
- [GOV.UK Design System](https://design-system.service.gov.uk/) shares research-informed service patterns. Localize UK-specific language and conventions for KQA's Australian English.
- [Pew Research Center: Writing Survey Questions](https://www.pewresearch.org/writing-survey-questions/) discusses question wording, response-option design, order effects, and pretesting.
- [AAPOR: Best Practices for Survey Research](https://aapor.org/standards-and-ethics/best-practices/) provides professional survey research and reporting practices; apply it with context rather than treating a static checker as a methods review.
- [Anthropic's frontend-design skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design) is optional inspiration for design iteration and critique. Its preferences are subjective and do not override accessibility standards or KQA product policy.

These sources inform the policy; this policy is not a claim that KQA has passed a full accessibility audit, questionnaire-methods review, or usability study. Content review and respondent pretesting require judgment and research. Automated checks, browser screenshots, keyboard walkthroughs, and assistive-technology review each provide different evidence and should be recorded separately.
