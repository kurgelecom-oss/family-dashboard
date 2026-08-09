import { NextResponse } from "next/server";

export async function GET() {
  try {
    const resp = await fetch(
      "https://api.tally.so/v1/forms/68Ygxo/submissions?limit=1&status=completed",
      {
        headers: {
          Authorization: `Bearer ${process.env.TALLY_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!resp.ok) {
      console.error("Tally API error:", resp.status, resp.statusText);
      return NextResponse.json({ error: "Failed to fetch Tally data" }, { status: 500 });
    }

    const data = await resp.json();
    const submissions = data.data || [];

    if (!submissions.length) {
      return NextResponse.json({ daysSince: null });
    }

    const latest = submissions[0];
    const dateAnswer = latest.answers?.find(
      (a: any) => a.field.id === "XYvWyO"
    );

    if (!dateAnswer || !dateAnswer.text) {
      return NextResponse.json({ daysSince: null });
    }

    const incidentDate = new Date(dateAnswer.text);
    const now = new Date();
    const daysSince = Math.floor((now.getTime() - incidentDate.getTime()) / (1000 * 60 * 60 * 24));

    return NextResponse.json({ daysSince, lastDate: dateAnswer.text });
  } catch (error) {
    console.error("Incident API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
