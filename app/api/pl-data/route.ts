import { NextResponse } from "next/server";

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxf6zd7xiws46_hy4hM8dnakaXhU45dCBNNzYHH8cLKaLZ0uq3UFrChZvNatkpvc0hH/exec";

export async function GET() {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Apps Script returned ${res.status}`);
    const data = await res.json();
    return NextResponse.json({ ...data, fetchedAt: Date.now() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
