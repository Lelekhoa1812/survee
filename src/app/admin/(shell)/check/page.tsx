import Link from "next/link";
import { Uploader } from "@/components/Uploader";

export const metadata = { title: "Check a file" };

export default function CheckPage() {
  return (
    <main className="page narrow">
      <div className="page-head">
        <div>
          <h1>Check a file</h1>
          <p>Find every problem before anyone sees the questionnaire. Nothing is saved. When something fails, copy the report and paste it to the AI agent that wrote the file.</p>
        </div>
      </div>
      <Uploader />
      <p className="muted" style={{ marginTop: 20, fontSize: 13.5 }}>
        New to the format? Read the <Link href="/admin/docs" style={{ textDecoration: "underline" }}>format guide</Link> or download the{" "}
        <a href="/api/docs/template/starter.kqa.html" style={{ textDecoration: "underline" }}>starter template</a>.
      </p>
    </main>
  );
}
