import { readDoc } from "./docs";

export const INTERVIEW_PACKAGE_VERSION = "kqa-interview-packages/1" as const;

export const INTERVIEW_PACKAGES = [
  { id: "product-discovery", title: "Product discovery", level: 2 },
  { id: "service-improvement", title: "Service improvement", level: 2 },
  { id: "workplace-process", title: "Workplace process", level: 2 },
  { id: "project-discovery", title: "Project discovery", level: 2 },
  { id: "education-learning", title: "Education and learning", level: 2 },
  { id: "health-service-experience", title: "Health service experience", level: 2 },
  { id: "personal-planning", title: "Personal planning", level: 2 },
  { id: "candidate-experience", title: "Candidate experience", level: 3 },
  { id: "employee-onboarding", title: "Employee onboarding and workplace experience", level: 3 },
  { id: "customer-success", title: "Customer success and account review", level: 3 },
  { id: "supplier-partner-review", title: "Supplier and partner review", level: 3 },
  { id: "safety-quality-learning", title: "Safety and quality learning", level: 3 },
  { id: "audit-readiness", title: "Audit readiness", level: 3 },
  { id: "program-evaluation", title: "Program evaluation", level: 3 },
  { id: "community-consultation", title: "Community consultation", level: 3 },
  { id: "event-feedback", title: "Event feedback", level: 3 },
  { id: "personal-wellbeing-reflection", title: "Personal wellbeing reflection", level: 3 },
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
export async function getInterviewPackage(packageId?: InterviewPackageId) {
  const source = await readDoc("INTERVIEW_PACKAGES.md");
  if (!source) return null;
  if (!packageId) return { packages: source, packageId: null, packageVersion: INTERVIEW_PACKAGE_VERSION };

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
  };
}
