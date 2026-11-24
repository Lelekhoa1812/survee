import Link from "next/link";
import { Badge, Icon } from "@/components/ui";
import { InterviewPageCursorError, InterviewPageFilterError, listInterviewPage, MAX_INTERVIEW_SEARCH_LENGTH } from "@/lib/repo";
import { relTime } from "@/lib/time";
import { adminSession } from "@/lib/http";

export const metadata = { title: "Interviews" };
export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ cursor?: string | string[]; search?: string | string[]; status?: string | string[]; mode?: string | string[] }> } = {}) {
  const session = await adminSession();
  const canManage = session?.role === "owner" || session?.role === "admin";
  const params = await searchParams;
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
  const search = typeof params.search === "string" ? params.search : "";
  const statusValue = typeof params.status === "string" ? params.status : "";
  const modeValue = typeof params.mode === "string" ? params.mode : "";
  const status: "open" | "closed" | undefined = statusValue === "open" || statusValue === "closed" ? statusValue : undefined;
  const mode: "single" | "multi" | undefined = modeValue === "single" || modeValue === "multi" ? modeValue : undefined;
  const invalidFilter = Boolean((statusValue && !status) || (modeValue && !mode) || search.length > MAX_INTERVIEW_SEARCH_LENGTH);
  const filters = { search: search.length <= MAX_INTERVIEW_SEARCH_LENGTH ? search : undefined, status, mode };
  const hasFilters = Boolean(filters.search?.trim() || filters.status || filters.mode);
  let page;
  let invalidCursor = false;
  try {
    page = await listInterviewPage({ cursor, ...filters });
  } catch (error) {
    if (error instanceof InterviewPageCursorError) {
      page = await listInterviewPage(filters);
      invalidCursor = true;
    } else if (error instanceof InterviewPageFilterError) {
      page = await listInterviewPage();
    } else throw error;
  }
  const { interviews } = page;
  const totals = interviews.reduce((a, i) => ({ people: a.people + i.counts.people, submitted: a.submitted + i.counts.submitted, active: a.active + (i.status === "open" ? 1 : 0) }), { people: 0, submitted: 0, active: 0 });
  const pageUrl = (nextCursor?: string) => {
    const query = new URLSearchParams();
    if (filters.search?.trim()) query.set("search", filters.search);
    if (filters.status) query.set("status", filters.status);
    if (filters.mode) query.set("mode", filters.mode);
    if (nextCursor) query.set("cursor", nextCursor);
    return query.size ? `/admin?${query.toString()}` : "/admin";
  };

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
      {invalidFilter && <p role="status" className="muted">One or more filters were invalid. Showing the available results.</p>}

      <form action="/admin" method="get" className="card row wrap" aria-label="Filter interviews" style={{ padding: 14, marginBottom: 18 }}>
        <label className="field" htmlFor="interview-search" style={{ flex: "2 1 260px", margin: 0 }}>
          <span>Search interviews</span>
          <input id="interview-search" className="input" name="search" type="search" maxLength={MAX_INTERVIEW_SEARCH_LENGTH} value={search} placeholder="Name or description" />
        </label>
        <label className="field" htmlFor="interview-status" style={{ flex: "1 1 140px", margin: 0 }}>
          <span>Status</span>
          <select id="interview-status" className="select" name="status" value={statusValue === "open" || statusValue === "closed" ? statusValue : ""}>
            <option value="">All statuses</option><option value="open">Open</option><option value="closed">Closed</option>
          </select>
        </label>
        <label className="field" htmlFor="interview-mode" style={{ flex: "1 1 150px", margin: 0 }}>
          <span>Mode</span>
          <select id="interview-mode" className="select" name="mode" value={modeValue === "single" || modeValue === "multi" ? modeValue : ""}>
            <option value="">All modes</option><option value="single">One person</option><option value="multi">Multi-user</option>
          </select>
        </label>
        <div className="row wrap"><button className="btn primary" type="submit">Apply filters</button>{hasFilters && <Link className="btn" href="/admin">Clear filters</Link>}</div>
      </form>

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
      ) : interviews.length === 0 && hasFilters ? (
        <section className="card empty">
          <div className="ico"><Icon name="search" size={24} /></div>
          <h2>No matching interviews</h2>
          <p>Try a different search or clear one or more filters.</p>
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
          {cursor ? <Link className="btn sm" href={pageUrl()}>Return to latest results</Link> : <span />}
          {page.nextCursor && <Link className="btn sm" href={pageUrl(page.nextCursor)}>Load older interviews</Link>}
        </nav>
      )}
    </main>
  );
}
