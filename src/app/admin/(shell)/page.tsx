import Link from "next/link";
import { Badge, Icon } from "@/components/ui";
import { listInterviews } from "@/lib/repo";
import { relTime } from "@/lib/time";

export const metadata = { title: "Interviews" };
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const interviews = await listInterviews();
  const totals = interviews.reduce((a, i) => ({ people: a.people + i.counts.people, submitted: a.submitted + i.counts.submitted, active: a.active + (i.status === "open" ? 1 : 0) }), { people: 0, submitted: 0, active: 0 });

  return (
    <main id="main-content" className="page" tabIndex={-1}>
      <div className="page-head">
        <div>
          <h1>Interviews</h1>
          <p>Each interview is one questionnaire. Email each person their private link, or copy it, and review what they answer.</p>
        </div>
        <Link href="/admin/new" className="btn primary right"><Icon name="plus" size={16} /> New interview</Link>
      </div>

      {interviews.length > 0 && (
        <div className="stats" style={{ marginBottom: 20 }}>
          <div className="stat"><b>{interviews.length}</b><span>{interviews.length === 1 ? "Interview" : "Interviews"}</span></div>
          <div className="stat"><b>{totals.active}</b><span>Open now</span></div>
          <div className="stat"><b>{totals.people}</b><span>People invited</span></div>
          <div className="stat"><b>{totals.submitted}</b><span>Submitted</span></div>
        </div>
      )}

      {interviews.length === 0 ? (
        <div className="card empty">
          <div className="ico"><Icon name="inbox" size={24} /></div>
          <h3>No interviews yet</h3>
          <p>Upload a questionnaire file and KQA gives each person a private link you can email or copy. Answers save automatically and you can export them any time.</p>
          <Link href="/admin/new" className="btn primary"><Icon name="plus" size={16} /> Create your first interview</Link>
        </div>
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
    </main>
  );
}
