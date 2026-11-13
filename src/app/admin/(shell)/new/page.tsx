import Link from "next/link";
import { NewInterview } from "@/components/NewInterview";
import { Icon } from "@/components/ui";

export const metadata = { title: "New interview" };

export default function NewPage() {
  return (
    <main className="page narrow">
      <Link href="/admin" className="crumb"><Icon name="arrowLeft" size={14} /> Interviews</Link>
      <div className="page-head">
        <div>
          <h1>New interview</h1>
          <p>Name it, choose how people answer, then upload the questionnaire. KQA checks the file before anything is created.</p>
        </div>
      </div>
      <NewInterview />
    </main>
  );
}
