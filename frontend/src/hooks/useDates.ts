import { format, startOfWeek, addWeeks, subWeeks, getWeek, getYear } from 'date-fns'

/** Return the Sunday of the week containing d */
export function sundayOfWeek(d: Date): Date {
  return startOfWeek(d, { weekStartsOn: 0 })  // 0 = Sunday
}

export function sundayOfToday(): string {
  return toISO(sundayOfWeek(new Date()))
}

export function toISO(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

export function fromISO(s: string): Date {
  return new Date(s + 'T00:00:00')
}

export function shiftWeek(isoSunday: string, dir: 1 | -1): string {
  const d = fromISO(isoSunday)
  return toISO(dir === 1 ? addWeeks(d, 1) : subWeeks(d, 1))
}

export function weekLabel(isoSunday: string): string {
  const sun = fromISO(isoSunday)
  const sat = new Date(sun); sat.setDate(sat.getDate() + 6)
  const wn  = getWeek(sun, { weekStartsOn: 0 })
  const yr  = getYear(sun)
  return `${yr} W${wn} (${format(sun, 'M/d')}~${format(sat, 'M/d')})`
}

export function shortDate(iso: string): string {
  return format(fromISO(iso), 'M/d')
}

/** Format a KST timestamp string (already local) into a relative label */
export function fmtTime(ts: string | null | undefined): string {
  if (!ts) return '-'
  const d = new Date(ts.replace(' ', 'T'))
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (isNaN(diff)) return ts
  if (diff < 60)    return '방금 전'
  if (diff < 3600)  return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  return format(d, 'M/d HH:mm')
}
