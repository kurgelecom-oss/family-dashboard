import { NextResponse } from "next/server";

// Temporary mock route for visual testing — delete once Shopify actuals confirmed working
export async function GET() {
  return NextResponse.json({
    daily:   { revenue: 720,   orders: 12  },
    weekly:  { revenue: 4860,  orders: 81  },
    monthly: { revenue: 12400, orders: 207 },
  });
}
