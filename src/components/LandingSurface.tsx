import Link from "next/link";
import { BrandMark } from "./ui";

const workflow = [
  {
    number: "01",
    title: "Bring your questionnaire",
    text: "Use a self-contained HTML file built for KQA. There is no in-app question builder to learn.",
  },
  {
    number: "02",
    title: "Check it before use",
    text: "Run the file checker to catch unsupported markup and answer controls before you invite anyone.",
  },
  {
    number: "03",
    title: "Share and review",
    text: "Give each person a private link, then review saved answers and export them from one workspace.",
  },
];

export function LandingSurface() {
  return (
    <main className="marketing-page">
      <header className="marketing-nav">
        <Link href="/" className="marketing-brand" aria-label="KQA home">
          <BrandMark size={34} wordmark />
        </Link>
        <nav className="marketing-nav-actions" aria-label="Account">
          <Link href="/admin/login" className="marketing-signin">Sign in</Link>
          <Link href="/signup" className="btn primary sm">Create a workspace</Link>
        </nav>
      </header>

      <div className="marketing-content">
        <section className="marketing-hero" aria-labelledby="marketing-title">
          <div className="marketing-hero-copy">
            <p className="marketing-eyebrow"><span aria-hidden="true" /> Interview hosting for research teams</p>
            <h1 id="marketing-title">Your questionnaire, hosted and ready to share.</h1>
            <p className="marketing-lede">Bring a self-contained HTML questionnaire. KQA checks the file, creates private interview links, saves answers as people respond, and keeps them ready to review or export.</p>
            <div className="marketing-actions">
              <Link href="/signup" className="btn primary lg">Create a workspace</Link>
              <Link href="/admin/login" className="btn ghost lg">Sign in</Link>
            </div>
            <p className="marketing-reassurance">Respondents do not need an account. Their answers save as they go.</p>
          </div>

          <section className="marketing-preview" aria-labelledby="marketing-preview-title">
            <div className="marketing-preview-head">
              <span className="marketing-preview-mark" aria-hidden="true"><BrandMark size={22} /></span>
              <div>
                <p className="marketing-preview-label">One clear workflow</p>
                <h2 id="marketing-preview-title">From questionnaire to review</h2>
              </div>
            </div>
            <ol className="marketing-flow">
              {workflow.map((step, index) => (
                <li className="marketing-flow-step" key={step.number}>
                  <span className="marketing-flow-number" aria-hidden="true">{step.number}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </div>
                  {index < workflow.length - 1 && <span className="marketing-flow-connector" aria-hidden="true" />}
                </li>
              ))}
            </ol>
            <p className="marketing-preview-foot">A host-controlled workspace for the whole interview lifecycle.</p>
          </section>
        </section>

        <section className="marketing-workflow" aria-labelledby="marketing-workflow-title">
          <div className="marketing-section-head">
            <p className="eyebrow">Built around your interview</p>
            <h2 id="marketing-workflow-title">A focused path from file to responses</h2>
          </div>
          <div className="marketing-benefits">
            <article className="marketing-benefit">
              <span className="marketing-benefit-number" aria-hidden="true">01</span>
              <h3>Work with your questionnaire</h3>
              <p>Keep the HTML file as the source of truth, including its structure and visual theme.</p>
            </article>
            <article className="marketing-benefit">
              <span className="marketing-benefit-number" aria-hidden="true">02</span>
              <h3>Know what you are sharing</h3>
              <p>Check questionnaire support before creating an interview and sending private links.</p>
            </article>
            <article className="marketing-benefit">
              <span className="marketing-benefit-number" aria-hidden="true">03</span>
              <h3>Stay in control</h3>
              <p>Review answers in the host workspace and export them when your team is ready.</p>
            </article>
          </div>
        </section>

        <section className="marketing-respondent" aria-labelledby="respondent-title">
          <div>
            <p className="eyebrow">For respondents</p>
            <h2 id="respondent-title">Have an interview link?</h2>
            <p>Open the private URL your host sent you to continue your interview. If you cannot find it or need a new one, contact your host.</p>
          </div>
          <p className="marketing-respondent-note">Your progress is saved to that link as you answer.</p>
        </section>

        <footer className="marketing-footer">
          <Link href="/" aria-label="KQA home"><BrandMark size={24} wordmark /></Link>
          <span>Interview hosting with clear controls for hosts and respondents.</span>
        </footer>
      </div>
    </main>
  );
}
