/**
 * Usage forecasting: pure logic, no SDK imports.
 */

export interface UsagePoint {
  readonly t: number
  readonly monthly: number
  readonly weekly: number
  readonly rolling: number
}

export interface Forecast {
  /** Percent of the monthly allowance per hour. */
  readonly ratePerHour: number
  /** Days until the monthly allowance reaches 100%, when the pace is positive. */
  readonly etaDays: number | null
  readonly spanHours: number
  readonly points: number
  readonly confidence: "low" | "ok"
}

export const HOUR = 3_600_000
export const DAY = 24 * HOUR

/**
 * Append a sample, keeping a bounded ring buffer.
 * Samples closer than `minGapMs` replace the previous one so a 60s poll does
 * not flood the history.
 */
export function pushPoint(
  points: readonly UsagePoint[],
  point: UsagePoint,
  minGapMs = 5 * 60_000,
  max = 2880,
): UsagePoint[] {
  const last = points[points.length - 1]
  if (last && point.t - last.t < minGapMs) {
    return [...points.slice(0, -1), point]
  }
  const next = [...points, point]
  return next.length > max ? next.slice(next.length - max) : next
}

export function forecast(points: readonly UsagePoint[], windowMs = 7 * DAY): Forecast | null {
  if (points.length < 3) return null

  const now = points[points.length - 1].t
  const window = points.filter((point) => point.t >= now - windowMs)
  if (window.length < 3) return null

  const first = window[0]
  const last = window[window.length - 1]
  const spanHours = (last.t - first.t) / HOUR
  if (spanHours < 6) return null

  const ratePerHour = (last.monthly - first.monthly) / spanHours
  if (ratePerHour <= 0) {
    return {
      ratePerHour,
      etaDays: null,
      spanHours,
      points: window.length,
      confidence: "ok",
    }
  }

  const remaining = Math.max(0, 100 - last.monthly)
  return {
    ratePerHour,
    etaDays: remaining / ratePerHour / 24,
    spanHours,
    points: window.length,
    confidence: "ok",
  }
}

/**
 * The panel's facts as text for the agent. Only the TUI records readings, so the
 * age of the last one is part of the answer.
 */
export function usageText(points: readonly UsagePoint[], now: number): string {
  const last = points[points.length - 1]
  if (!last) {
    return "No readings yet: open /limits in the TUI once so the panel records one."
  }

  const age = now - last.t
  const lines = [
    `monthly ${Math.round(last.monthly)}% · weekly ${Math.round(last.weekly)}% · rolling 5h ${Math.round(last.rolling)}%`,
    age < 60_000
      ? "last reading just now"
      : `last reading ${formatSpan(age)} ago, recorded while the panel was open`,
  ]

  const result = forecast(points)
  if (!result) {
    lines.push("rate: not enough history yet")
  } else if (result.ratePerHour <= 0) {
    lines.push(`rate: no change over ${Math.round(result.spanHours)}h (${result.points} points)`)
  } else {
    lines.push(
      `rate: ${result.ratePerHour.toFixed(2)}%/h over ${Math.round(result.spanHours)}h (${result.points} points)`,
    )
    if (result.etaDays !== null) {
      lines.push(`limit: in ~${Math.round(result.etaDays)} days at this rate`)
    }
  }
  return lines.join("\n")
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

/**
 * Start of the monthly billing cycle that ends at `resetsAt`.
 * The API only exposes the reset instant, so a cycle is one calendar month.
 */
export function cycleStart(resetsAt: number): number {
  const end = new Date(resetsAt)
  const year = end.getUTCFullYear()
  const month = end.getUTCMonth() - 1
  const day = Math.min(end.getUTCDate(), daysInMonth(year, month))
  return Date.UTC(
    year,
    month,
    day,
    end.getUTCHours(),
    end.getUTCMinutes(),
    end.getUTCSeconds(),
    end.getUTCMilliseconds(),
  )
}

export interface PaceEstimate {
  /** Projected percentage of the monthly limit at reset. */
  readonly projected: number
  readonly ratePerHour: number
  readonly elapsedHours: number
}

/**
 * Projects the current percentage to the end of the cycle from cycle progress.
 * This is the Console's own formula: average spend since the start of the
 * period, extrapolated linearly to `resetsAt`. The Console hides the forecast
 * for the first day of a period and while nothing has been used, so this does
 * too — that keeps the sidebar and the Console showing the same number.
 */
export function cyclePace(percent: number, resetsAt: number, now: number): PaceEstimate | null {
  const start = cycleStart(resetsAt)
  const total = resetsAt - start
  const elapsed = Math.min(Math.max(now, start), resetsAt) - start
  if (!Number.isFinite(percent) || percent <= 0 || elapsed < DAY || total <= 0) return null

  return {
    projected: (percent * total) / elapsed,
    ratePerHour: percent / (elapsed / HOUR),
    elapsedHours: elapsed / HOUR,
  }
}

/**
 * Projected percentage of the monthly limit at reset.
 *
 * The Console formula (`cyclePace`) hides the forecast on the first day of a
 * cycle. The panel still shows the row there, so it falls back to the rate
 * measured from local snapshots when one exists.
 */
export function projectLimit(input: {
  readonly percent: number
  readonly resetsAt: number
  readonly now: number
  readonly ratePerHour?: number | null
}): number | null {
  const pace = cyclePace(input.percent, input.resetsAt, input.now)
  if (pace) return pace.projected
  if (input.percent <= 0) return null
  const rate = input.ratePerHour ?? 0
  if (!(rate > 0)) return null
  const hoursToReset = Math.max(0, (input.resetsAt - input.now) / HOUR)
  return input.percent + rate * hoursToReset
}

export function bar(percent: number, width = 8): string {
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.round((clamped / 100) * width)
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled))
}

const SPARK_GLYPHS = "▁▂▃▄▅▆▇█"

/**
 * Renders the newest `width` values as a one-line chart.
 * A flat series still gets a baseline instead of a misleading ramp.
 */
export function sparkline(values: readonly number[], width = 7): string {
  const data = values.filter((value) => Number.isFinite(value)).slice(-width)
  if (data.length === 0) return ""

  const min = Math.min(...data)
  const max = Math.max(...data)
  if (max <= min) return SPARK_GLYPHS[0].repeat(data.length)

  return data
    .map((value) => {
      const index = Math.round(((value - min) / (max - min)) * (SPARK_GLYPHS.length - 1))
      return SPARK_GLYPHS[Math.max(0, Math.min(SPARK_GLYPHS.length - 1, index))]
    })
    .join("")
}

export interface ModelShare {
  readonly name: string
  readonly cost: number
  /** Fraction of the total cost in the window, 0..1. */
  readonly share: number
}

export interface CostByModel {
  readonly model: { readonly id: string }
  readonly cost: number
}

/** Models with the largest cost in a stats window, with their share of the total. */
export function modelShares(models: readonly CostByModel[], limit = 3): ModelShare[] {
  const total = models.reduce((sum, item) => sum + Math.max(0, item.cost), 0)
  if (total <= 0) return []

  return models
    .filter((item) => item.cost > 0)
    .slice()
    .sort((a, b) => b.cost - a.cost)
    .slice(0, limit)
    .map((item) => ({
      name: item.model.id.replace(/^.*\//, ""),
      cost: item.cost,
      share: item.cost / total,
    }))
}

export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return "—"
  if (Math.abs(value) >= 100) return value.toFixed(0)
  return value.toFixed(2)
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return "—"
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(Math.round(value))
}

export function formatSpan(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "now"
  const days = Math.floor(ms / DAY)
  const hours = Math.floor((ms % DAY) / HOUR)
  if (days > 0) return hours ? `${days}d ${hours}h` : `${days}d`
  const minutes = Math.max(1, Math.floor((ms % HOUR) / 60_000))
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

export function meterColor(percent: number): "success" | "warning" | "error" {
  if (percent >= 90) return "error"
  if (percent >= 70) return "warning"
  return "success"
}
