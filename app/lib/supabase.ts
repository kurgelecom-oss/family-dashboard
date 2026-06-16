import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

export function getTodayDate() {
  return new Date().toISOString().split("T")[0]
}

// Returns Monday of the current week (Sydney time)
export function getWeekStart() {
  const now = new Date()
  const day = now.getDay() // 0=Sun,1=Mon,...,6=Sat
  const diff = day === 0 ? -6 : 1 - day // adjust to Monday
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff)
  return monday.toISOString().split("T")[0]
}

// Returns today's day name
export function getTodayDayName() {
  return new Date().toLocaleDateString("en-AU", { weekday: "long" })
}
