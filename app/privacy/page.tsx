import Link from "next/link";
import { Card, PageTitle } from "@/components/Shell";

// DRAFT. A plain description of what the code does today, not reviewed legal text. Have it
// reviewed (DPDP / GDPR) before the public launch, and bump TERMS_VERSION in lib/auth.ts when it
// changes so sign-in records the new version.

export default function Privacy() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Privacy" sub="Draft. What Offerly stores, where, and how to remove it." />
      <Card className="grid gap-4 text-sm leading-relaxed">
        <section>
          <h2 className="mb-1 text-base font-medium">Your account</h2>
          <p>We store your email address to sign you in, and your profile (name, target role, companies, job description, resume text, goals) so it is the same on every device.</p>
        </section>
        <section>
          <h2 className="mb-1 text-base font-medium">Your practice data</h2>
          <p>Interview sessions, reports, notes, stories and roadmaps are stored in this browser for now, separately for each account that signs in here. They are not yet copied to our servers.</p>
        </section>
        <section>
          <h2 className="mb-1 text-base font-medium">AI processing</h2>
          <p>During an interview, the transcript and your profile text are sent to Google&apos;s Gemini API to run the interviewer and the scoring. Audio and video recordings are never stored.</p>
        </section>
        <section>
          <h2 className="mb-1 text-base font-medium">Your choices</h2>
          <p>In Settings you can export everything as JSON, delete your data, or delete your account. Deleting your account removes your email, profile and consent records from our servers.</p>
        </section>
        <p className="text-muted">See also the <Link href="/terms" className="underline">Terms</Link>.</p>
      </Card>
    </div>
  );
}
