import Link from "next/link";
import { notFound } from "next/navigation";
import { PreviewFrame } from "@/components/PreviewFrame";
import { adminSession } from "@/lib/http";
import { getInterview, getQuestionnaireReviewDraft } from "@/lib/repo";

export const metadata = { title: "Questionnaire preview" };
export const dynamic = "force-dynamic";

export default async function QuestionnaireReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await adminSession();
  if (!session) notFound();
  const draft = await getQuestionnaireReviewDraft(id, session.tenantId);
  if (!draft) notFound();
  const interview = await getInterview(draft.interviewId, session.tenantId);
  if (!interview) notFound();

  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Questionnaire review</div>
          <h1>{interview.name}</h1>
          <p>Candidate for version {draft.expectedVersion + 1}. This is a read-only preview; publishing remains a separate MCP action.</p>
        </div>
        <Link className="btn" href={`/admin/interviews/${draft.interviewId}`}>Open interview</Link>
      </div>
      <section className="card" aria-labelledby="candidate-questionnaire-title">
        <div className="page-head" style={{ marginBottom: 12 }}>
          <div>
            <h2 id="candidate-questionnaire-title">Candidate questionnaire</h2>
            <p>{draft.questions.length} questions · Expires {draft.expiresAt.toISOString().replace("T", " ").replace(".000Z", " UTC")}</p>
          </div>
        </div>
        <PreviewFrame
          src={`/api/admin/previews/${id}/frame`}
          questions={draft.questions}
          height={720}
          title={`Questionnaire candidate for ${interview.name}`}
        />
      </section>
    </main>
  );
}
