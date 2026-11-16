import Link from "next/link";
import { NewInterview } from "@/components/NewInterview";
import { Icon } from "@/components/ui";
import { redirect } from "next/navigation";
import { adminSession } from "@/lib/http";

export const metadata = { title: "New interview" };

export default async function NewPage() {
  const session = await adminSession();
  if (!session || session.role === "member") redirect("/admin");
  return (
    <main id="main-content" className="page narrow" tabIndex={-1}>
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
