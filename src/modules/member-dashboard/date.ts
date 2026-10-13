export type MemberDateValue = string | number | null | undefined

export function parseMemberDate(value: MemberDateValue): number | null {
  if (value === null || typeof value === 'undefined') return null

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return value < 10_000_000_000 ? value * 1000 : value
  }

  const cleanValue = value.trim()
  if (!cleanValue) return null

  if (/^\d+$/.test(cleanValue)) {
    const numericValue = Number(cleanValue)
    if (!Number.isFinite(numericValue)) return null
    return numericValue < 10_000_000_000 ? numericValue * 1000 : numericValue
  }

  const dateOnlyMatch = cleanValue.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime()
  }

  const parsedValue = Date.parse(cleanValue)
  return Number.isNaN(parsedValue) ? null : parsedValue
}

export function formatMemberDate(
  value: MemberDateValue,
  fallback = 'Not recorded'
): string {
  const timestamp = parseMemberDate(value)
  if (timestamp === null) return fallback

  return new Date(timestamp).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function daysUntilMemberDate(value: MemberDateValue): number | null {
  const timestamp = parseMemberDate(value)
  if (timestamp === null) return null

  const expiryDate = new Date(timestamp)
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const expiryStart = new Date(
    expiryDate.getFullYear(),
    expiryDate.getMonth(),
    expiryDate.getDate()
  ).getTime()

  return Math.ceil((expiryStart - todayStart) / 86_400_000)
}
