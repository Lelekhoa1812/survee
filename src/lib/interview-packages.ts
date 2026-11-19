import { readDoc } from "./docs";

export const INTERVIEW_PACKAGE_VERSION = "kqa-interview-packages/12" as const;

export const INTERACTION_PATTERN_IDS = [
  "all", "guided", "guided-question", "routing", "question-order-variation", "ranking",
  "independent-ratings", "option-randomization", "repeat", "required-answer",
] as const;

export const INTERVIEW_PACKAGES = [
  {
    id: "product-discovery", title: "Product discovery", level: 2,
    decisionFocus: "Discover a real, recent user problem or unmet need before choosing a solution.",
    respondents: "People who recently experienced the activity or problem being explored.",
    useWhen: "The team needs to understand context, current workarounds, friction, or unmet needs.",
    notFor: "Validating demand by asking people to predict purchases or choose a proposed feature.",
    riskFlags: [], relatedPackages: ["service-improvement", "customer-success"],
    interactionGuidance: {
      consider: [
        { pattern: "routing", when: "A respondent reports a specific recent problem that needs one follow-up.", benefit: "Keeps irrelevant detail out of other respondents' path.", tradeoff: "A route adds hidden-answer behavior that must be disclosed and tested." },
        { pattern: "guided-question", when: "Mobile or early task testing shows one prompt at a time helps people describe a recent experience.", benefit: "Focuses attention on one concrete experience.", tradeoff: "Adds navigation turns and may interrupt a respondent's own narrative." },
        { pattern: "option-randomization", when: "An unordered nominal list is long enough for option position to plausibly influence response selection.", benefit: "Distributes presentation-order effects across respondents.", tradeoff: "Keep fixed choices by explicit value, retain shown order, and do not claim rotation removes bias." },
      ],
      avoid: [{ pattern: "ranking", when: "The question asks respondents to predict future demand or choose hypothetical features.", reason: "A forced order is not evidence of an experienced need or likely behavior." }],
      decisionChecks: ["Does the interaction match recent experience rather than hypothetical preference?", "Does each route or step reduce respondent burden without hiding relevant evidence?"],
    },
  },
  {
    id: "service-improvement", title: "Service improvement", level: 2,
    decisionFocus: "Improve a defined service interaction or journey.",
    respondents: "People who recently tried to complete a task with the named service.",
    useWhen: "The service and recall period are known and the host wants to locate friction or recovery needs.",
    notFor: "An unmonitored complaint, urgent-help, statutory-reporting, or emergency channel.",
    riskFlags: [], relatedPackages: ["product-discovery", "customer-success", "health-service-experience"],
    interactionGuidance: {
      consider: [
        { pattern: "routing", when: "A follow-up applies only to a service touchpoint the respondent actually used.", benefit: "Avoids asking about inapplicable steps.", tradeoff: "Include a clear not-used path and test route changes and retained answers." },
        { pattern: "guided", when: "A longer service journey has distinct stages and respondent testing favors staged review.", benefit: "Can make a complex journey easier to navigate.", tradeoff: "More steps can make a short feedback task feel longer." },
      ],
      avoid: [{ pattern: "ranking", when: "The prompt asks respondents to rank every service problem or failure.", reason: "People may have ties, lack experience of some items, or need independent ratings instead." }],
      decisionChecks: ["Can respondents distinguish experienced, unexperienced, and not-applicable touchpoints?", "Does each stage correspond to the journey respondents can recall?"],
    },
  },
  {
    id: "workplace-process", title: "Workplace process", level: 2,
    decisionFocus: "Improve a workflow, handoff, or operating process.",
    respondents: "Staff or other people who perform or depend on the defined process.",
    useWhen: "The inquiry concerns how work moves across steps, roles, or teams.",
    notFor: "Ranking individuals, measuring general organizational climate, or assessing employee performance.",
    riskFlags: ["employment-context review"], relatedPackages: ["employee-onboarding", "industrial-operations"],
    interactionGuidance: {
      consider: [{ pattern: "routing", when: "A short follow-up applies to a workflow branch the respondent directly experienced.", benefit: "Keeps the path relevant to the person's work context.", tradeoff: "Role, team, and location branches can reveal identity in small groups." }],
      avoid: [
        { pattern: "ranking", when: "The subject is a person, team, or individual performance.", reason: "survee is not an employee-ranking or performance-assessment tool." },
        { pattern: "question-order-variation", when: "Questions encode workflow chronology, handoffs, or dependencies.", reason: "Changing their order can damage context and interpretation." },
      ],
      decisionChecks: ["Could any branch combination identify a worker or small team?", "Can every answer be optional without making the process decision unusable?"],
    },
  },
  {
    id: "industrial-operations", title: "Industrial operations", level: 2,
    decisionFocus: "Improve recurring production and maintenance workflows and surface worker-observed resource-efficiency opportunities for qualified investigation.",
    respondents: "Operators, maintenance and planning staff, supervisors, and process partners with recent experience.",
    useWhen: "The host has defined the workflow, reference period, improvement owner, and monitored route for urgent concerns.",
    notFor: "Live shift handover, hazard or incident reports, safety investigations, energy audits or verified savings estimates, compliance certification, or individual performance review.",
    riskFlags: ["workforce power imbalance and identifiability", "operational confidentiality", "safety-reporting boundary"], relatedPackages: ["workplace-process", "safety-quality-learning", "supplier-partner-review", "audit-readiness"],
    interactionGuidance: {
      consider: [
        { pattern: "guided-question", when: "Short attention windows or mobile/workfloor access make a stepwise path plausible and intended workers can test it.", benefit: "Can focus one routine improvement prompt at a time.", tradeoff: "Navigation adds effort during a shift; do not assume guided is faster." },
        { pattern: "routing", when: "An optional routine coordination follow-up is relevant only after an explicit prior constraint selection.", benefit: "Limits irrelevant follow-up detail.", tradeoff: "Never route into incident or hazard reporting, and test what happens to retained answers." },
      ],
      avoid: [
        { pattern: "repeat", when: "The proposed rows would be shift, incident, or live operational records.", reason: "survee is not an operational log, handover, or safety-reporting channel." },
        { pattern: "ranking", when: "The prompt ranks workers, hazards, or all possible resource opportunities.", reason: "This can turn exploratory feedback into consequential assessment or overstate worker evidence." },
      ],
      decisionChecks: ["Is this a non-urgent improvement inquiry with a separate monitored safety route?", "Has the stepwise flow been tested with the relevant worker groups and devices?"],
    },
  },
  {
    id: "project-discovery", title: "Project discovery", level: 2,
    decisionFocus: "Clarify desired outcomes, constraints, dependencies, and the next project decision.",
    respondents: "Sponsors, delivery stakeholders, and affected users with relevant project knowledge.",
    useWhen: "A project is being shaped and the team needs to expose assumptions or alignment gaps.",
    notFor: "Replacing a project plan, technical discovery, or formal approval record.",
    riskFlags: [], relatedPackages: ["product-discovery", "program-evaluation"],
    interactionGuidance: {
      consider: [{ pattern: "guided", when: "A long project brief contains distinct stages and the respondent needs a staged path.", benefit: "Can separate outcomes, constraints, dependencies, and decisions.", tradeoff: "Separate perspectives explicitly; a staged form does not establish alignment." }],
      avoid: [{ pattern: "ranking", when: "The prompt asks stakeholders to force-order every constraint or dependency.", reason: "Forced order can hide ties and disagreements that matter to the project decision." }],
      decisionChecks: ["Does each stage preserve the respondent's own perspective?", "Would a short all-at-once form be easier for this brief?"],
    },
  },
  {
    id: "education-learning", title: "Education and learning", level: 2,
    decisionFocus: "Improve access, support, or experience in a defined learning activity.",
    respondents: "Learners, educators, or caregivers who can speak to the specified activity.",
    useWhen: "The goal is to improve a learning experience or identify practical support needs.",
    notFor: "Assessing an individual's ability, disability, attainment, or eligibility for support.",
    riskFlags: ["age-appropriate privacy and consent review"], relatedPackages: ["program-evaluation", "employee-onboarding"],
    interactionGuidance: {
      consider: [
        { pattern: "guided-question", when: "Age, reading level, cognitive load, or device testing supports one prompt at a time.", benefit: "Can reduce competing instructions on a small screen.", tradeoff: "The step sequence itself adds comprehension and navigation work; offer an appropriate alternative." },
        { pattern: "routing", when: "A follow-up applies only to a learning activity the person actually experienced.", benefit: "Avoids questions about activities outside the respondent's experience.", tradeoff: "Test comprehension of the branch and avoid sensitive inference." },
      ],
      avoid: [{ pattern: "ranking", when: "The request involves learner ability, attainment, disability, or eligibility.", reason: "This package must not assess, score, or rank learners." }],
      decisionChecks: ["Can learners and caregivers understand every branch and optional response?", "Are age-appropriate support and consent arrangements in place?"],
    },
  },
  {
    id: "health-service-experience", title: "Health service experience", level: 2,
    decisionFocus: "Improve access to or communication from a specific health service.",
    respondents: "Patients or carers with recent experience of the named service, including family or unpaid carers where relevant.",
    useWhen: "The host needs local, non-clinical feedback about service access or communication, including a bounded module about carers' experience accessing support services.",
    notFor: "Symptom screening, diagnosis, clinical outcomes, urgent needs, caregiver needs assessment, eligibility, care planning, or a substitute for a tested instrument.",
    riskFlags: ["health-data minimization", "third-party care-recipient data", "clinical and privacy review"], relatedPackages: ["service-improvement", "program-evaluation"],
    interactionGuidance: {
      consider: [
        { pattern: "routing", when: "The next item concerns a recent service touchpoint the respondent confirms they used.", benefit: "Reduces irrelevant follow-up questions.", tradeoff: "Routes can imply sensitive facts; minimize detail and test accessibility and privacy." },
        { pattern: "guided-question", when: "A short stepwise service-experience flow demonstrably reduces burden for the intended group.", benefit: "Can keep one service-experience prompt in focus.", tradeoff: "Extra navigation is itself burden and must be tested in the relevant language and access modes." },
      ],
      avoid: [
        { pattern: "ranking", when: "The choices concern clinical options, symptoms, outcomes, or caregiver needs.", reason: "The package cannot make or score clinical or care decisions." },
        { pattern: "required-answer", when: "A response would require sensitive health or third-party care-recipient detail.", reason: "Do not make sensitive disclosure a condition of completing the feedback task." },
      ],
      decisionChecks: ["Could the interaction reveal a sensitive health or care fact beyond what is necessary?", "Has the complete language and accessibility journey been reviewed?"],
    },
  },
  {
    id: "personal-planning", title: "Personal planning", level: 2,
    decisionFocus: "Help a person define a self-chosen goal and practical next step.",
    respondents: "An individual or household member choosing whether to reflect on a change.",
    useWhen: "The person wants to articulate goals, resources, or next steps without prescribed advice, including preparing their own priorities and questions for a later conversation with a qualified professional.",
    notFor: "Professional financial, legal, medical, therapeutic, or crisis advice; assessing treatment options or recommending a clinical choice.",
    riskFlags: ["personal disclosure minimization", "health-data minimization", "clinical-advice boundary"], relatedPackages: ["personal-wellbeing-reflection"],
    interactionGuidance: {
      consider: [{ pattern: "guided-question", when: "The person prefers optional one-at-a-time prompts for their own goals and questions.", benefit: "Can make self-directed reflection feel manageable.", tradeoff: "Added steps can feel prescriptive; keep skip, back, review, and exit clear." }],
      avoid: [
        { pattern: "routing", when: "A route would depend on sensitive disclosure or imply a clinical conclusion.", reason: "A branch must not be interpreted as need, risk, consent, or treatment suitability." },
        { pattern: "ranking", when: "The prompt asks for a definitive order of life priorities or clinical choices.", reason: "A forced order may misrepresent changing or tied priorities and can imply advice." },
      ],
      decisionChecks: ["Can the person skip reflection without explanation or penalty?", "Does the flow avoid implying that responses are monitored or clinically interpreted?"],
    },
  },
  {
    id: "candidate-experience", title: "Candidate experience", level: 3,
    decisionFocus: "Improve the clarity, access, and communication of a hiring process.",
    respondents: "Applicants or candidates who experienced a defined hiring stage.",
    useWhen: "The feedback is separate from selection and cannot change an individual's hiring outcome.",
    notFor: "Screening, ranking, selection, protected-attribute collection, or accommodation eligibility.",
    riskFlags: ["employment selection boundary", "candidate privacy"], relatedPackages: ["employee-onboarding"],
    interactionGuidance: {
      consider: [{ pattern: "all", when: "The process is complete and feedback is short, optional, and clearly separate from selection.", benefit: "One concise path can reduce the impression of another assessment.", tradeoff: "A long form may still be burdensome; verify the separation with candidates." }],
      avoid: [
        { pattern: "guided", when: "The extra steps could be mistaken for an ongoing hiring assessment.", reason: "Candidates may feel compelled to continue or disclose more." },
        { pattern: "ranking", when: "The question asks hosts to compare or rank candidates.", reason: "Candidate feedback must not affect selection or score people." },
        { pattern: "required-answer", when: "A person is being asked for optional experience feedback after selection has ended.", reason: "Required responses can undermine voluntary participation." },
      ],
      decisionChecks: ["Is the feedback path visibly separate from hiring decisions?", "Could a candidate interpret any response as affecting their outcome?"],
    },
  },
  {
    id: "employee-onboarding", title: "Employee onboarding and workplace experience", level: 3,
    decisionFocus: "Improve a new employee's time-bounded first weeks at work.",
    respondents: "New employees at a defined point in the onboarding period.",
    useWhen: "The target is role clarity, readiness, access to tools, or support during onboarding.",
    notFor: "Performance, conduct, accommodation eligibility, or recurring organization-wide climate measurement.",
    riskFlags: ["employment-context review", "identity and confidentiality limits"], relatedPackages: ["workplace-process"],
    interactionGuidance: {
      consider: [
        { pattern: "guided", when: "The brief covers distinct, bounded onboarding phases and users benefit from a staged path.", benefit: "Keeps each phase's questions together.", tradeoff: "A stage or timing branch can identify a new starter in a small team." },
        { pattern: "routing", when: "A support follow-up is relevant only to the employee's actual onboarding experience.", benefit: "Avoids irrelevant questions.", tradeoff: "Use broad, non-identifying conditions and test route visibility." },
      ],
      avoid: [{ pattern: "required-answer", when: "Employees may perceive the inquiry as manager-directed or evaluative.", reason: "Compulsory participation can compromise trust and candour." }],
      decisionChecks: ["Could an answer combination identify a new employee?", "Can the host report learning without turning it into a performance or climate score?"],
    },
  },
  {
    id: "customer-success", title: "Customer success and account review", level: 3,
    decisionFocus: "Understand progress toward a customer goal already agreed with the provider.",
    respondents: "Customers or account contacts familiar with the agreed outcome and service period.",
    useWhen: "A provider and customer are reviewing progress, blockers, and feasible next steps.",
    notFor: "General unmet-need discovery, formal support tickets, renewal pressure, or collecting secrets.",
    riskFlags: [], relatedPackages: ["product-discovery", "service-improvement"],
    interactionGuidance: {
      consider: [{ pattern: "routing", when: "Optional blocker or support items apply only when the pre-agreed customer goal is off track or help is requested.", benefit: "Keeps the review aligned with the agreed outcome.", tradeoff: "Do not treat branch patterns as an account-health signal." }],
      avoid: [{ pattern: "ranking", when: "The flow might be used to rank accounts or pressure renewal decisions.", reason: "The package is not a scoring or renewal-pressure instrument." }],
      decisionChecks: ["Is the goal and review period already agreed with the customer?", "Would an optional response route imply monitoring or an automatic escalation?"],
    },
  },
  {
    id: "supplier-partner-review", title: "Supplier and partner review", level: 3,
    decisionFocus: "Improve a defined working relationship or delivery against agreed requirements.",
    respondents: "Supplier, partner, and internal process owners with direct delivery knowledge.",
    useWhen: "The review covers a named scope, contract period, deliverable, or milestone.",
    notFor: "Replacing formal procurement, contract notice, dispute, or assurance decisions.",
    riskFlags: ["commercial confidentiality"], relatedPackages: ["workplace-process", "audit-readiness"],
    interactionGuidance: {
      consider: [
        { pattern: "guided", when: "The review spans distinct delivery, coordination, and next-step topics.", benefit: "Can separate different kinds of evidence.", tradeoff: "More navigation may reduce completion and can expose commercial details." },
        { pattern: "repeat", when: "A few named deliverables share the same compact fields and must be examined separately.", benefit: "Keeps repeated instances structured and comparable.", tradeoff: "Rows increase recall and export burden; they are not a contract or assurance record." },
      ],
      avoid: [{ pattern: "ranking", when: "The result could be interpreted as formal supplier scoring or procurement advice.", reason: "This package does not replace procurement, contract, dispute, or assurance decisions." }],
      decisionChecks: ["Can respondents answer without credentials, contract files, or unnecessary confidential detail?", "Are repeated deliverables truly comparable under the same small field set?"],
    },
  },
  {
    id: "safety-quality-learning", title: "Safety and quality learning", level: 3,
    decisionFocus: "Understand conditions and barriers that may prevent recurrence.",
    respondents: "People involved in or close to a defined activity, event, or near miss.",
    useWhen: "The host has a separate monitored incident process and wants non-punitive learning feedback.",
    notFor: "Emergency response, statutory incident reporting, hazard notification, or individual blame decisions.",
    riskFlags: ["safety escalation route required", "sensitive event details"], relatedPackages: ["workplace-process", "program-evaluation"],
    interactionGuidance: {
      consider: [{ pattern: "guided-question", when: "A post-event, non-punitive reflection sequence has been tested with people who may find a full page difficult.", benefit: "Can let a respondent move through a small number of prompts at their own pace.", tradeoff: "Steps can imply screening or escalation; a separate monitored incident route is mandatory." }],
      avoid: [
        { pattern: "routing", when: "A branch would screen urgency, assess a hazard, or trigger an operational response.", reason: "survee does not monitor responses or provide safety escalation." },
        { pattern: "repeat", when: "Rows would act as incident, hazard, or shift logs.", reason: "This package is not an incident-reporting or operational-log system." },
        { pattern: "required-answer", when: "The question requests a sensitive event narrative or account of a near miss.", reason: "Do not make potentially distressing disclosure mandatory." },
      ],
      decisionChecks: ["Is there a separately monitored route for urgent and statutory reports?", "Does the interaction avoid implying immediate review, protection, or response?"],
    },
  },
  {
    id: "audit-readiness", title: "Audit and compliance readiness", level: 3,
    decisionFocus: "Locate evidence gaps, process owners, and follow-up before an authorized review.",
    respondents: "Process and control owners who know where approved evidence is held.",
    useWhen: "A qualified owner needs a preliminary view of evidence availability and responsibility.",
    notFor: "Certifying compliance, collecting evidence files or credentials, or interpreting requirements without a qualified owner.",
    riskFlags: ["regulated or assurance review"], relatedPackages: ["supplier-partner-review", "program-evaluation"],
    interactionGuidance: {
      consider: [{ pattern: "routing", when: "Applicability is known from an earlier non-sensitive answer and the question only locates an approved evidence owner or source.", benefit: "Keeps out-of-scope controls out of the respondent's path.", tradeoff: "Applicability and unknown states need explicit, stable handling." }],
      avoid: [
        { pattern: "question-order-variation", when: "Questions follow a stable control, requirement, or evidence sequence.", reason: "Random order can make answers hard to compare and review." },
        { pattern: "ranking", when: "The form could be read as scoring or certifying control effectiveness or compliance.", reason: "A questionnaire response is not audit evidence or assurance." },
      ],
      decisionChecks: ["Are 'unknown' and 'not applicable' available where truthful?", "Does the form avoid collecting proof, credentials, or making a compliance conclusion?"],
    },
  },
  {
    id: "program-evaluation", title: "Program evaluation", level: 3,
    decisionFocus: "Collect participant or delivery evidence against a defined program evaluation question.",
    respondents: "Program participants, delivery partners, or staff selected for a stated evaluation purpose.",
    useWhen: "An evaluation owner has defined the program logic, evaluation question, indicators, and evidence sources.",
    notFor: "Treating questionnaire self-report as a complete evaluation design or proof of causal impact.",
    riskFlags: ["methodology and domain review"], relatedPackages: ["education-learning", "community-consultation"],
    interactionGuidance: {
      consider: [
        { pattern: "guided", when: "Sections map to a declared program logic model or evaluation question.", benefit: "Can separate participation, delivery, and reported outcomes.", tradeoff: "The sequence can privilege some evidence and does not establish causal impact." },
        { pattern: "routing", when: "A question applies only to people who received a specific program component.", benefit: "Avoids asking people to evaluate an exposure they did not have.", tradeoff: "Branches can exclude low-exposure and non-completers from important learning." },
        { pattern: "repeat", when: "The evaluation unit repeats and distinct instances materially affect the analysis.", benefit: "Preserves a small, typed record per instance.", tradeoff: "Define the unit and cap; repeated self-report does not replace administrative or mixed-method evidence." },
      ],
      avoid: [{ pattern: "ranking", when: "The evaluation asks respondents to order all outcomes, experiences, or options without a true strict-order construct.", reason: "Forced ranks hide ties and do not establish impact or a causal priority." }],
      decisionChecks: ["Does the route reflect actual exposure rather than assume participation?", "What non-questionnaire evidence is needed for the evaluation claim?"],
    },
  },
  {
    id: "community-consultation", title: "Community consultation", level: 3,
    decisionFocus: "Inform a named public or community decision while options are still open.",
    respondents: "Affected residents, community groups, or people who use the relevant place or service.",
    useWhen: "The decision-maker, decision window, recruitment method, and plan for reporting back are known.",
    notFor: "A representative vote or population estimate without a defensible sampling design.",
    riskFlags: ["coverage and accessibility gaps", "public-sector or ethics review where applicable"], relatedPackages: ["program-evaluation", "service-improvement"],
    interactionGuidance: {
      consider: [
        { pattern: "guided", when: "A long consultation has distinct, accessible topics and respondent testing supports a staged path.", benefit: "Can make a complex consultation easier to navigate.", tradeoff: "Opt-in digital routes and added steps can narrow who completes it." },
        { pattern: "independent-ratings", when: "Respondents may rate multiple issues similarly or leave some unrated.", benefit: "Allows ties and independent judgments.", tradeoff: "Interpretation still depends on recruitment, coverage, and who chose to respond." },
        { pattern: "ranking", when: "A complete strict order of no more than eight real alternatives is central to the decision and pretested.", benefit: "Captures relative order when ties are intentionally disallowed.", tradeoff: "Adds cognitive and mobile burden and excludes tied or unranked options." },
      ],
      avoid: [{ pattern: "ranking", when: "The host wants a representative vote, population estimate, or prioritization where ties are valid.", reason: "Full ranking cannot create representativeness and can misstate equal preferences." }],
      decisionChecks: ["Who cannot participate through the selected digital, language, or accessibility path?", "Is relative order truly the construct, or are independent ratings more honest?"],
    },
  },
  {
    id: "event-feedback", title: "Event feedback", level: 3,
    decisionFocus: "Improve access, schedule, content, or logistics for a named event.",
    respondents: "Attendees, speakers, staff, or volunteers with experience of the event.",
    useWhen: "The event and which parts the respondent experienced can be identified.",
    notFor: "Handling access requests, urgent complaints, or issues that require a monitored response.",
    riskFlags: ["accessibility needs route"], relatedPackages: ["service-improvement", "community-consultation"],
    interactionGuidance: {
      consider: [
        { pattern: "routing", when: "Feedback asks about sessions or activities that an attendee may not have used.", benefit: "Avoids irrelevant questions about unexperienced parts of the event.", tradeoff: "Use a clear not-attended route and do not infer all-attendee sentiment from voluntary replies." },
        { pattern: "guided-question", when: "A brief post-event form is completed on mobile and a short stepwise path tests better.", benefit: "Can focus attention on one event aspect at a time.", tradeoff: "Extra steps can lower completion after the event." },
      ],
      avoid: [{ pattern: "ranking", when: "The question would rank event staff or claim to represent all attendees.", reason: "Feedback is voluntary and must not become an individual rating or population claim." }],
      decisionChecks: ["Can respondents distinguish which activities they experienced?", "Is there a separate route for urgent access needs or complaints?"],
    },
  },
  {
    id: "personal-wellbeing-reflection", title: "Personal reflection and wellbeing", level: 3,
    decisionFocus: "Support optional, self-directed reflection about what matters to the person now.",
    respondents: "An individual choosing whether to reflect on personal priorities or a next step.",
    useWhen: "The purpose is personal reflection with an explicit skip option and no clinical interpretation.",
    notFor: "Screening, diagnosis, therapy, financial advice, crisis response, or decisions about care or eligibility.",
    riskFlags: ["sensitive personal disclosure", "crisis support boundary"], relatedPackages: ["personal-planning"],
    interactionGuidance: {
      consider: [{ pattern: "guided-question", when: "A person actively chooses optional self-reflection and prefers one short prompt at a time.", benefit: "Can support a private, self-paced reflection.", tradeoff: "Additional steps may burden someone who is distressed; keep skip and exit clear." }],
      avoid: [
        { pattern: "routing", when: "A branch depends on sensitive disclosure or could be read as assessing risk or need.", reason: "survee does not provide crisis monitoring, diagnosis, or care referral." },
        { pattern: "ranking", when: "The prompt requires ordering personal priorities or asks a person to justify a sensitive choice.", reason: "Reflection must remain optional and cannot score or prescribe a person's priorities." },
        { pattern: "required-answer", when: "The item concerns sensitive personal or wellbeing information.", reason: "Do not require disclosure to complete the reflection." },
      ],
      decisionChecks: ["Can a respondent skip or exit without penalty or explanation?", "Does the interface avoid implying that answers are monitored or interpreted clinically?"],
    },
  },
] as const;

export type InterviewPackageId = (typeof INTERVIEW_PACKAGES)[number]["id"];

function section(markdown: string, title: string, level: number): string | null {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line === `${"#".repeat(level)} ${title}`);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const heading = /^(#{1,6})\s/.exec(lines[i]);
    if (heading && heading[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

/** Return the shared safeguards and catalog with just the requested package body. */
export async function getInterviewPackage(packageId?: InterviewPackageId, options: { catalogOnly?: boolean } = {}) {
  const source = await readDoc("INTERVIEW_PACKAGES.md");
  if (!source) return null;
  const packageCatalog = INTERVIEW_PACKAGES.map(({ id, title, decisionFocus, respondents, useWhen, notFor, riskFlags, relatedPackages, interactionGuidance }) => ({
    id, title, decisionFocus, respondents, useWhen, notFor, riskFlags, relatedPackages,
    interactionGuidance,
  }));
  const selectionGuidance = "Choose by the decision to be informed, respondent group, and collection context—not industry label alone. These are survee self-completed questionnaire starting points, not moderated interview guides. Compare related packages when a brief overlaps. Carer support-service feedback can fit health-service experience; formal caregiver needs assessment, eligibility, safeguarding, and care planning remain outside scope. Personal planning may help a respondent organize their own priorities and questions before a professional conversation; clinical treatment assessment, scoring, or recommendations are outside scope. If purpose, audience, modality, or risk boundary is unclear, return the candidates and ask a concise clarifying question; do not invent a fit score or imply that a package is validated. `interactionGuidance` lists contextual affordances and reasons to avoid patterns; it is neither a required recipe nor a fit score. Omitted patterns are not endorsed or ruled out. Start with a short all-at-once flow unless task and respondent evidence supports another presentation; offer optionality and a non-digital alternative where needed. Consider ranking only when a complete strict order of every option (survee supports 2–8) is the construct; use independent ratings when ties or unranked options are meaningful. Use routing only when earlier answers determine applicability, keep branches bounded, and disclose that inactive answers remain saved. Use repeat rows only for distinct instances of the same small structured unit, never as operational or incident logs. Consider option randomization only for unordered nominal categories, keep fixed values explicitly declared, and retain presented-order provenance.";
  if (options.catalogOnly) {
    if (packageId) return null;
    return { packageId: null, packageVersion: INTERVIEW_PACKAGE_VERSION, packageCatalog, selectionGuidance, catalogOnly: true };
  }
  if (!packageId) return { packages: source, packageId: null, packageVersion: INTERVIEW_PACKAGE_VERSION, packageCatalog, selectionGuidance };

  const selected = INTERVIEW_PACKAGES.find((item) => item.id === packageId);
  if (!selected) return null;
  const intro = source.split(/^## /m)[0].trim();
  const shared = [
    section(source, "Common operating procedure", 2),
    section(source, "Risk-based release gate", 2),
    section(source, "Package selection", 2),
    section(source, "Sampling and reporting plan", 2),
    section(source, selected.title, selected.level),
  ].filter((part): part is string => !!part);
  return {
    packages: `# ${selected.title} (${packageId})\n\nPackage library: ${INTERVIEW_PACKAGE_VERSION}.\n\n${intro}\n\n${shared.join("\n\n")}`,
    packageId,
    packageVersion: INTERVIEW_PACKAGE_VERSION,
    packageCatalog,
    selectionGuidance,
  };
}
