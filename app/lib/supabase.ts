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

// Returns Monday of the PREVIOUS week (Melbourne/AEST time, safe for server-side use)
export function getLastWeekStart() {
  // Always derive the calendar date from Melbourne timezone — never rely on server UTC
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date())
  const y  = Number(parts.find((p) => p.type === "year")!.value)
  const mo = Number(parts.find((p) => p.type === "month")!.value)
  const d  = Number(parts.find((p) => p.type === "day")!.value)

  // Day-of-week for the AEST date (local midnight construction is safe here
  // because we only care about the weekday, not the UTC timestamp)
  const aestDate = new Date(y, mo - 1, d)
  const dow  = aestDate.getDay()
  const diff = dow === 0 ? -6 : 1 - dow   // offset to reach this Monday

  // Last Monday = this Monday − 7 days; use local accessors to avoid toISOString UTC shift
  const lastMon = new Date(y, mo - 1, d + diff - 7)
  const ly = lastMon.getFullYear()
  const lm = String(lastMon.getMonth() + 1).padStart(2, "0")
  const ld = String(lastMon.getDate()).padStart(2, "0")
  const result = `${ly}-${lm}-${ld}`

  const aestStr = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  console.log(`[getLastWeekStart] AEST today: ${aestStr} | last Monday: ${result}`)
  return result
}

// Returns today's day name
export function getTodayDayName() {
  return new Date().toLocaleDateString("en-AU", { weekday: "long" })
}
