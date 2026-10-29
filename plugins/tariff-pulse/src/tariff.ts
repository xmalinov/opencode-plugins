/**
 * Tariff clock: pure logic, no SDK imports.
 *
 * DeepSeek bills by wall-clock window: peak is 01:00-04:00 and 06:00-10:00 UTC
 * on weekdays, excluding Chinese public holidays. Everything else is off-peak
 * at exactly half the peak price.
 */

export type Tier = "peak" | "offPeak"

export interface Price {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite?: number
}

export interface PeakWindow {
  /** UTC weekday numbers, 0 = Sunday. */
  readonly days: readonly number[]
  /** UTC "HH:MM". */
  readonly from: string
  /** UTC "HH:MM". */
  readonly to: string
}

export interface HolidayCalendar {
  readonly dates: readonly string[]
  /** Beijing-local date after which the calendar must be refreshed. */
  readonly validUntil: string
  readonly source?: string
  readonly retrievedAt?: string
}

export interface ModelTariff {
  readonly aliases?: readonly string[]
  readonly prices?: Readonly<Record<Tier, Price>>
}

export interface Tariff {
  readonly id: string
  readonly label: string
  readonly providers: readonly string[]
  readonly windowsUTC: readonly PeakWindow[]
  readonly peakMultiplier: number
  readonly holidays?: HolidayCalendar | null
  readonly models: Readonly<Record<string, ModelTariff>>
  readonly sourceURL?: string
  readonly pricesAsOf?: string
}

export interface TierState {
  readonly tariffID: string
  readonly tariffLabel: string
  readonly modelKey: string
  readonly tier: Tier
  readonly reason: "window" | "holiday" | "outside"
  readonly nextChangeAt: number | null
  readonly confidence: "exact" | "weekday-only"
  readonly prices?: Price
}

const MINUTE = 60_000
const DAY = 86_400_000
const BEIJING_OFFSET = 8 * 60 * MINUTE

const beijing = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** Beijing-local calendar date as YYYY-MM-DD. */
export function beijingDate(at: Date): string {
  const parts = beijing.formatToParts(at)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? ""
  return `${pick("year")}-${pick("month")}-${pick("day")}`
}

function beijingMidnight(date: string): number {
  const [year, month, day] = date.split("-").map(Number)
  return Date.UTC(year, month - 1, day) - BEIJING_OFFSET
}

function clock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

function dayStartUTC(at: Date, offsetDays: number): number {
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + offsetDays)
}

function inWindow(at: Date, window: PeakWindow): boolean {
  const from = clock(window.from)
  const to = clock(window.to)
  if (from === null || to === null || from === to) return false

  const day = at.getUTCDay()
  const minutes = at.getUTCHours() * 60 + at.getUTCMinutes()

  if (from < to) return window.days.includes(day) && minutes >= from && minutes < to
  return (
    (window.days.includes(day) && minutes >= from) ||
    (window.days.includes((day + 6) % 7) && minutes < to)
  )
}

export function hasFreshCalendar(calendar: HolidayCalendar | null | undefined, at: Date): boolean {
  if (!calendar || calendar.dates.length === 0) return false
  return beijingDate(at) <= calendar.validUntil
}

export function isHoliday(at: Date, calendar: HolidayCalendar | null | undefined): boolean {
  if (!hasFreshCalendar(calendar, at)) return false
  return calendar!.dates.includes(beijingDate(at))
}

export function tierAt(at: Date, tariff: Tariff): Tier {
  if (isHoliday(at, tariff.holidays)) return "offPeak"
  return tariff.windowsUTC.some((window) => inWindow(at, window)) ? "peak" : "offPeak"
}

/**
 * First instant after `now` whose tier differs from `current`.
 * Candidates are window edges and holiday midnights, so this stays cheap and
 * exact without scanning minute by minute.
 */
export function nextTierChange(now: Date, tariff: Tariff, current: Tier): number | null {
  const start = now.getTime()
  const candidates = new Set<number>()

  for (let offset = 0; offset < 14; offset += 1) {
    const base = dayStartUTC(now, offset)
    const day = new Date(base).getUTCDay()
    for (const window of tariff.windowsUTC) {
      if (!window.days.includes(day)) continue
      const from = clock(window.from)
      const to = clock(window.to)
      if (from === null || to === null) continue
      candidates.add(base + from * MINUTE)
      candidates.add(base + (to > from ? to : to + 1440) * MINUTE)
    }
  }

  for (const date of tariff.holidays?.dates ?? []) {
    const edge = beijingMidnight(date)
    candidates.add(edge)
    candidates.add(edge + DAY)
  }

  const ordered = [...candidates].filter((time) => time > start).sort((a, b) => a - b)
  for (const time of ordered) {
    // A boundary instant belongs to the new state; step one second inside it.
    if (tierAt(new Date(time + 1000), tariff) !== current) return time
  }
  return null
}

/**
 * The meeting point for provider ids and catalogue names: `deepseek-v4.1-flash`,
 * `DeepSeek V4.1 Flash` and `deepseek-flash-1017` all have to resolve to the same
 * model. Case and punctuation go first, then a snapshot stamp.
 *
 * Labels are deliberately NOT stripped: `-free` is a different tariff (the free
 * variants must not inherit paid prices), so only the dated suffix churns.
 */
export function modelKey(value: string): string {
  const key = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

  // A stamp is dropped only when at least four characters of the name remain:
  // a model whose whole name is a number must survive.
  const stripped = key.replace(/-\d{4,6}$/, (stamp) =>
    key.length - stamp.length >= 4 ? "" : stamp,
  )
  return stripped.replace(/^-|-$/g, "")
}

export function findModel(tariff: Tariff, modelID: string): [string, ModelTariff] | null {
  const direct = tariff.models[modelID]
  if (direct) return [modelID, direct]

  const wanted = modelKey(modelID)
  if (!wanted) return null
  for (const [key, model] of Object.entries(tariff.models)) {
    if (modelKey(key) === wanted) return [key, model]
    if (model.aliases?.some((alias) => modelKey(alias) === wanted)) return [key, model]
  }
  return null
}

/**
 * Resolve the current tier for a provider/model pair.
 * Returns null when the provider or model is outside this tariff — never
 * guesses from the model name.
 */
export function resolveTier(
  at: Date,
  tariff: Tariff,
  providerID: string,
  modelID: string,
): TierState | null {
  if (!tariff.providers.includes(providerID)) return null
  const found = findModel(tariff, modelID)
  if (!found) return null

  const [modelKey, model] = found
  const holiday = isHoliday(at, tariff.holidays)
  const inPeak = tariff.windowsUTC.some((window) => inWindow(at, window))
  const tier: Tier = holiday ? "offPeak" : inPeak ? "peak" : "offPeak"
  const reason = holiday ? "holiday" : inPeak ? "window" : "outside"

  return {
    tariffID: tariff.id,
    tariffLabel: tariff.label,
    modelKey,
    tier,
    reason,
    nextChangeAt: nextTierChange(at, tariff, tier),
    confidence: hasFreshCalendar(tariff.holidays, at) ? "exact" : "weekday-only",
    prices: model.prices?.[tier],
  }
}

export function discountPercent(tariff: Tariff): number {
  if (tariff.peakMultiplier <= 1) return 0
  return Math.round((1 - 1 / tariff.peakMultiplier) * 100)
}

/** Compact countdown: 42m, 1h 42m, 2d 4h. */
export function formatShort(ms: number | null): string {
  if (ms === null) return "—"
  if (ms <= 30_000) return "now"
  const minutes = Math.ceil(ms / MINUTE)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours ? `${days}d ${restHours}h` : `${days}d`
}

export function formatClock(at: number | null): string {
  if (at === null) return "—"
  const date = new Date(at)
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${hours}:${minutes}`
}

export function formatPrice(value: number): string {
  if (value === 0) return "0"
  if (value >= 1) return value.toFixed(2)
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}
