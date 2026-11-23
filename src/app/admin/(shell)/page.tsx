import Link from "next/link";
import { Badge, Icon } from "@/components/ui";
import { InterviewPageCursorError, listInterviewPage } from "@/lib/repo";
import { relTime } from "@/lib/time";
import { adminSession } from "@/lib/http";

export const metadata = { title: "Interviews" };
export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ cursor?: string | string[] }> } = {}) {
  const session = await adminSession();
  const canManage = session?.role === "owner" || session?.role === "admin";
  const params = await searchParams;
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
  let page;
  let invalidCursor = false;
  try {
    page = await listInterviewPage({ cursor });
  } catch (error) {
    if (!(error instanceof InterviewPageCursorError)) throw error;
    page = await listInterviewPage();
    invalidCursor = true;
  }
  const { interviews } = page;
  const totals = interviews.reduce((a, i) => ({ people: a.people + i.counts.people, submitted: a.submitted + i.counts.submitted, active: a.active + (i.status === "open" ? 1 : 0) }), { people: 0, submitted: 0, active: 0 });

  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <div className="page-head">
        <div>
          <h1>Interviews</h1>
          <p>{interviews.length === 0
            ? "Turn a questionnaire file into a hosted interview. survee saves answers as people respond and gives you one place to review and export them."
            : canManage ? "Each interview is one questionnaire. Email each person their private link, or copy it, and review what they answer." : "Review interview setup and aggregate response analysis for your workspace."}</p>
        </div>
        {canManage && interviews.length > 0 && <Link href="/admin/new" className="btn primary right"><Icon name="plus" size={16} /> New interview</Link>}
      </div>

      {invalidCursor && <p role="status" className="muted">That interview page link is invalid or expired. Showing the latest interviews.</p>}

      {interviews.length > 0 && (
        <div className="stats" style={{ marginBottom: 20 }}>
          <div className="stat"><b>{interviews.length}</b><span>{interviews.length === 1 ? "Interview on this page" : "Interviews on this page"}</span></div>
          <div className="stat"><b>{totals.active}</b><span>Open on this page</span></div>
          <div className="stat"><b>{totals.people}</b><span>People invited on this page</span></div>
          <div className="stat"><b>{totals.submitted}</b><span>Submitted on this page</span></div>
        </div>
      )}

      {interviews.length === 0 && cursor ? (
        <section className="card empty">
          <div className="ico"><Icon name="info" size={24} /></div>
          <h2>No more interviews</h2>
          <p>You have reached the end of the interview list.</p>
          <Link href="/admin" className="btn sm">Return to latest interviews</Link>
        </section>
      ) : interviews.length === 0 && !canManage ? (
        <section className="card empty">
          <div className="ico"><Icon name="info" size={24} /></div>
          <h2>No interviews yet</h2>
          <p>Ask a workspace owner or admin to create the first interview. Once it is ready, you can review its setup and aggregate analysis here.</p>
        </section>
      ) : interviews.length === 0 ? (
        <section className="card first-run" aria-labelledby="first-run-title">
          <div className="first-run-intro">
            <div className="eyebrow">Your first interview</div>
            <h2 id="first-run-title">Start with a questionnaire file</h2>
            <p>survee hosts your HTML questionnaire, checks it before use, and gives each respondent a private link. Answers save as they go.</p>
          </div>
          <ol className="first-run-steps">
            <li className="first-run-step">
              <div className="first-run-step-head">
                <span className="first-run-number" aria-hidden="true">1</span>
                <h3>Get a questionnaire</h3>
              </div>
              <p>Already have a survee HTML file? Check it in the next step. To make one, build a basic questionnaire in the create flow, start from the template, or give the Format guide bundle to an AI agent.</p>
              <div className="first-run-links">
                <Link href="/admin/docs" className="btn sm first-run-action">Format guide and AI agent bundle</Link>
                <a className="first-run-text-link" href="/api/docs/template/starter.kqa.html" download>Download starter template</a>
              </div>
            </li>
            <li className="first-run-step">
              <div className="first-run-step-head">
                <span className="first-run-number" aria-hidden="true">2</span>
                <h3>Check the file</h3>
              </div>
              <p>Check that the HTML and answer controls are supported. This read-only check does not create an interview; the create flow checks the file again.</p>
              <div className="first-run-links">
                <Link href="/admin/check" className="btn sm first-run-action">Check a file</Link>
              </div>
            </li>
            <li className="first-run-step">
              <div className="first-run-step-head">
                <span className="first-run-number" aria-hidden="true">3</span>
                <h3>Create and share</h3>
              </div>
              <p>Name the interview and choose whether one person or several people will answer. Then email each private link or copy a link to share.</p>
              <div className="first-run-links">
                <Link href="/admin/new" className="btn primary first-run-action"><Icon name="plus" size={16} /> Create your first interview</Link>
              </div>
            </li>
          </ol>
        </section>
      ) : (
        <div className="card">
          <div className="list">
            {interviews.map((i) => {
              const pct = i.counts.people ? Math.round((i.counts.submitted / i.counts.people) * 100) : 0;
              return (
                <Link key={i.id} href={`/admin/interviews/${i.id}`} className="list-row interview-row">
                  <div style={{ minWidth: 0 }}>
                    <div className="name">{i.name}</div>
                    <div className="desc">{i.description || `Survey version ${i.currentVersion}`}</div>
                  </div>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <Badge plain>{i.mode === "multi" ? "Multi-user" : "One person"}</Badge>
                    {i.status === "closed" ? <Badge kind="warn">Closed</Badge> : <Badge kind="ok">Open</Badge>}
                  </div>
                  <div style={{ display: "grid", gap: 5 }}>
                    <div className="bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
                    <span className="muted" style={{ fontSize: 13 }}>{i.counts.submitted} of {i.counts.people} submitted{i.counts.inProgress ? ` · ${i.counts.inProgress} in progress` : ""}</span>
                  </div>
                  <span className="muted nowrap" style={{ fontSize: 13 }}>{relTime(i.lastActivityAt ?? i.updatedAt)}</span>
                  <Icon name="chevron" size={16} className="muted" />
                </Link>
              );
            })}
          </div>
        </div>
      )}
      {interviews.length > 0 && (cursor || page.nextCursor) && (
        <nav aria-label="Interview pages" className="row wrap" style={{ justifyContent: "space-between", marginTop: 16 }}>
          {cursor ? <Link className="btn sm" href="/admin">Return to latest interviews</Link> : <span />}
          {page.nextCursor && <Link className="btn sm" href={`/admin?cursor=${encodeURIComponent(page.nextCursor)}`}>Load older interviews</Link>}
        </nav>
      )}
    </main>
  );
}
