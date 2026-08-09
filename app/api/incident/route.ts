import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FORM_ID = "68Ygxo";
const DATE_QUESTION_ID = "XYvWyO"; // "Date of incident" field

// Days between the incident date and today, both read as calendar dates in
// Australia/Sydney so a submission at 11pm Sydney doesn't read a day off.
function daysSinceSydney(incidentYmd: string): number {
  const todayYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // en-CA => YYYY-MM-DD

  const incident = new Date(`${incidentYmd}T00:00:00Z`);
  const today = new Date(`${todayYmd}T00:00:00Z`);
  return Math.max(
    0,
    Math.floor((today.getTime() - incident.getTime()) / 86400000)
  );
}

export async function GET() {
  const token = process.env.TALLY_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Missing TALLY_API_TOKEN" }, { status: 500 });
  }

  try {
    const resp = await fetch(
      `https://api.tally.so/forms/${FORM_ID}/submissions?limit=1`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );

    if (!resp.ok) {
      return NextResponse.json(
        { error: `Tally ${resp.status}` },
        { status: 502 }
      );
    }

    const data = await resp.json();
    const submissions = data.submissions ?? [];
    if (!submissions.length) {
      return NextResponse.json({ daysSince: null });
    }

    // The API returns the most recent submission first at limit=1, but sort by
    // submittedAt anyway so we never depend on undocumented ordering.
    submissions.sort(
      (a: any, b: any) =>
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );

    const latest = submissions[0];
    const dateResp = (latest.responses ?? []).find(
      (r: any) => r.questionId === DATE_QUESTION_ID
    );

    // INPUT_DATE answers come back as a bare "YYYY-MM-DD" string.
    const ymd = typeof dateResp?.answer === "string" ? dateResp.answer : null;
    if (!ymd) {
      return NextResponse.json({ daysSince: null });
    }

    return NextResponse.json({ daysSince: daysSinceSydney(ymd), lastDate: ymd });
  } catch {
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
}
