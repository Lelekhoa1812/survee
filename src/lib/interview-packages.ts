import { readDoc } from "./docs";

export const INTERVIEW_PACKAGE_VERSION = "kqa-interview-packages/7" as const;

export const INTERVIEW_PACKAGES = [
  {
    id: "product-discovery", title: "Product discovery", level: 2,
    decisionFocus: "Discover a real, recent user problem or unmet need before choosing a solution.",
    respondents: "People who recently experienced the activity or problem being explored.",
    useWhen: "The team needs to understand context, current workarounds, friction, or unmet needs.",
    notFor: "Validating demand by asking people to predict purchases or choose a proposed feature.",
    riskFlags: [], relatedPackages: ["service-improvement", "customer-success"],
  },
  {
    id: "service-improvement", title: "Service improvement", level: 2,
    decisionFocus: "Improve a defined service interaction or journey.",
    respondents: "People who recently tried to complete a task with the named service.",
    useWhen: "The service and recall period are known and the host wants to locate friction or recovery needs.",
    notFor: "An unmonitored complaint, urgent-help, statutory-reporting, or emergency channel.",
    riskFlags: [], relatedPackages: ["product-discovery", "customer-success", "health-service-experience"],
  },
  {
    id: "workplace-process", title: "Workplace process", level: 2,
    decisionFocus: "Improve a workflow, handoff, or operating process.",
    respondents: "Staff or other people who perform or depend on the defined process.",
    useWhen: "The inquiry concerns how work moves across steps, roles, or teams.",
    notFor: "Ranking individuals, measuring general organizational climate, or assessing employee performance.",
    riskFlags: ["employment-context review"], relatedPackages: ["employee-onboarding", "industrial-operations"],
  },
  {
    id: "industrial-operations", title: "Industrial operations", level: 2,
    decisionFocus: "Improve recurring production and maintenance workflows with input from the people doing the work.",
    respondents: "Operators, maintenance and planning staff, supervisors, and process partners with recent experience.",
    useWhen: "The host has defined the workflow, reference period, improvement owner, and monitored route for urgent concerns.",
    notFor: "Live shift handover, hazard or incident reports, safety investigations, compliance certification, or individual performance review.",
    riskFlags: ["workforce power imbalance and identifiability", "operational confidentiality", "safety-reporting boundary"], relatedPackages: ["workplace-process", "safety-quality-learning", "supplier-partner-review", "audit-readiness"],
  },
  {
    id: "project-discovery", title: "Project discovery", level: 2,
    decisionFocus: "Clarify desired outcomes, constraints, dependencies, and the next project decision.",
    respondents: "Sponsors, delivery stakeholders, and affected users with relevant project knowledge.",
    useWhen: "A project is being shaped and the team needs to expose assumptions or alignment gaps.",
    notFor: "Replacing a project plan, technical discovery, or formal approval record.",
    riskFlags: [], relatedPackages: ["product-discovery", "program-evaluation"],
  },
  {
    id: "education-learning", title: "Education and learning", level: 2,
    decisionFocus: "Improve access, support, or experience in a defined learning activity.",
    respondents: "Learners, educators, or caregivers who can speak to the specified activity.",
    useWhen: "The goal is to improve a learning experience or identify practical support needs.",
    notFor: "Assessing an individual's ability, disability, attainment, or eligibility for support.",
    riskFlags: ["age-appropriate privacy and consent review"], relatedPackages: ["program-evaluation", "employee-onboarding"],
  },
  {
    id: "health-service-experience", title: "Health service experience", level: 2,
    decisionFocus: "Improve access to or communication from a specific health service.",
    respondents: "Patients or carers with recent experience of the named service.",
    useWhen: "The host needs local, non-clinical feedback about service access or communication.",
    notFor: "Symptom screening, diagnosis, clinical outcomes, urgent needs, or a substitute for a tested instrument.",
    riskFlags: ["health-data minimization", "clinical and privacy review"], relatedPackages: ["service-improvement", "program-evaluation"],
  },
  {
    id: "personal-planning", title: "Personal planning", level: 2,
    decisionFocus: "Help a person define a self-chosen goal and practical next step.",
    respondents: "An individual or household member choosing whether to reflect on a change.",
    useWhen: "The person wants to articulate goals, resources, or next steps without prescribed advice.",
    notFor: "Professional financial, legal, medical, therapeutic, or crisis advice.",
    riskFlags: ["personal disclosure minimization"], relatedPackages: ["personal-wellbeing-reflection"],
  },
  {
    id: "candidate-experience", title: "Candidate experience", level: 3,
    decisionFocus: "Improve the clarity, access, and communication of a hiring process.",
    respondents: "Applicants or candidates who experienced a defined hiring stage.",
    useWhen: "The feedback is separate from selection and cannot change an individual's hiring outcome.",
    notFor: "Screening, ranking, selection, protected-attribute collection, or accommodation eligibility.",
    riskFlags: ["employment selection boundary", "candidate privacy"], relatedPackages: ["employee-onboarding"],
  },
  {
    id: "employee-onboarding", title: "Employee onboarding and workplace experience", level: 3,
    decisionFocus: "Improve a new employee's time-bounded first weeks at work.",
    respondents: "New employees at a defined point in the onboarding period.",
    useWhen: "The target is role clarity, readiness, access to tools, or support during onboarding.",
    notFor: "Performance, conduct, accommodation eligibility, or recurring organization-wide climate measurement.",
    riskFlags: ["employment-context review", "identity and confidentiality limits"], relatedPackages: ["workplace-process"],
  },
  {
    id: "customer-success", title: "Customer success and account review", level: 3,
    decisionFocus: "Understand progress toward a customer goal already agreed with the provider.",
    respondents: "Customers or account contacts familiar with the agreed outcome and service period.",
    useWhen: "A provider and customer are reviewing progress, blockers, and feasible next steps.",
    notFor: "General unmet-need discovery, formal support tickets, renewal pressure, or collecting secrets.",
    riskFlags: [], relatedPackages: ["product-discovery", "service-improvement"],
  },
  {
    id: "supplier-partner-review", title: "Supplier and partner review", level: 3,
    decisionFocus: "Improve a defined working relationship or delivery against agreed requirements.",
    respondents: "Supplier, partner, and internal process owners with direct delivery knowledge.",
    useWhen: "The review covers a named scope, contract period, deliverable, or milestone.",
    notFor: "Replacing formal procurement, contract notice, dispute, or assurance decisions.",
    riskFlags: ["commercial confidentiality"], relatedPackages: ["workplace-process", "audit-readiness"],
  },
  {
    id: "safety-quality-learning", title: "Safety and quality learning", level: 3,
    decisionFocus: "Understand conditions and barriers that may prevent recurrence.",
    respondents: "People involved in or close to a defined activity, event, or near miss.",
    useWhen: "The host has a separate monitored incident process and wants non-punitive learning feedback.",
    notFor: "Emergency response, statutory incident reporting, hazard notification, or individual blame decisions.",
    riskFlags: ["safety escalation route required", "sensitive event details"], relatedPackages: ["workplace-process", "program-evaluation"],
  },
  {
    id: "audit-readiness", title: "Audit and compliance readiness", level: 3,
    decisionFocus: "Locate evidence gaps, process owners, and follow-up before an authorized review.",
    respondents: "Process and control owners who know where approved evidence is held.",
    useWhen: "A qualified owner needs a preliminary view of evidence availability and responsibility.",
    notFor: "Certifying compliance, collecting evidence files or credentials, or interpreting requirements without a qualified owner.",
    riskFlags: ["regulated or assurance review"], relatedPackages: ["supplier-partner-review", "program-evaluation"],
  },
  {
    id: "program-evaluation", title: "Program evaluation", level: 3,
    decisionFocus: "Collect participant or delivery evidence against a defined program evaluation question.",
    respondents: "Program participants, delivery partners, or staff selected for a stated evaluation purpose.",
    useWhen: "An evaluation owner has defined the program logic, evaluation question, indicators, and evidence sources.",
    notFor: "Treating questionnaire self-report as a complete evaluation design or proof of causal impact.",
    riskFlags: ["methodology and domain review"], relatedPackages: ["education-learning", "community-consultation"],
  },
  {
    id: "community-consultation", title: "Community consultation", level: 3,
    decisionFocus: "Inform a named public or community decision while options are still open.",
    respondents: "Affected residents, community groups, or people who use the relevant place or service.",
    useWhen: "The decision-maker, decision window, recruitment method, and plan for reporting back are known.",
    notFor: "A representative vote or population estimate without a defensible sampling design.",
    riskFlags: ["coverage and accessibility gaps", "public-sector or ethics review where applicable"], relatedPackages: ["program-evaluation", "service-improvement"],
  },
  {
    id: "event-feedback", title: "Event feedback", level: 3,
    decisionFocus: "Improve access, schedule, content, or logistics for a named event.",
    respondents: "Attendees, speakers, staff, or volunteers with experience of the event.",
    useWhen: "The event and which parts the respondent experienced can be identified.",
    notFor: "Handling access requests, urgent complaints, or issues that require a monitored response.",
    riskFlags: ["accessibility needs route"], relatedPackages: ["service-improvement", "community-consultation"],
  },
  {
    id: "personal-wellbeing-reflection", title: "Personal reflection and wellbeing", level: 3,
    decisionFocus: "Support optional, self-directed reflection about what matters to the person now.",
    respondents: "An individual choosing whether to reflect on personal priorities or a next step.",
    useWhen: "The purpose is personal reflection with an explicit skip option and no clinical interpretation.",
    notFor: "Screening, diagnosis, therapy, financial advice, crisis response, or decisions about care or eligibility.",
    riskFlags: ["sensitive personal disclosure", "crisis support boundary"], relatedPackages: ["personal-planning"],
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
  const packageCatalog = INTERVIEW_PACKAGES.map(({ id, title, decisionFocus, respondents, useWhen, notFor, riskFlags, relatedPackages }) => ({
    id, title, decisionFocus, respondents, useWhen, notFor, riskFlags, relatedPackages,
  }));
  const selectionGuidance = "Choose by the decision to be informed, respondent group, and collection context—not industry label alone. These are KQA self-completed questionnaire starting points, not moderated interview guides. Compare related packages when a brief overlaps. If purpose, audience, modality, or risk boundary is unclear, return the candidates and ask a concise clarifying question; do not invent a fit score or imply that a package is validated.";
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
