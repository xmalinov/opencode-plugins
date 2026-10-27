import type { HolidayCalendar, Tariff } from "./tariff.js"

/**
 * DeepSeek pricing and schedule, checked 2026-10-27.
 * Source: https://api-docs.deepseek.com/quick_start/pricing
 *
 * Peak: 01:00-04:00 and 06:00-10:00 UTC, Monday-Friday.
 * Holidays of the PRC are off-peak for the whole day.
 * Off-peak is exactly half of peak.
 */
export const DEEPSEEK_SOURCE = "https://api-docs.deepseek.com/quick_start/pricing"
export const PRICES_AS_OF = "2026-10-27"

export const DEEPSEEK_HOLIDAYS_2026: HolidayCalendar = {
  // Public holidays per the State Council schedule (mirrored by timor.tech).
  // Make-up workdays are not listed: they fall on weekends, which are off-peak anyway.
  dates: [
    "2026-01-01",
    "2026-01-02",
    "2026-01-03",
    "2026-02-15",
    "2026-02-16",
    "2026-02-17",
    "2026-02-18",
    "2026-02-19",
    "2026-02-20",
    "2026-02-21",
    "2026-02-22",
    "2026-02-23",
    "2026-04-04",
    "2026-04-05",
    "2026-04-06",
    "2026-05-01",
    "2026-05-02",
    "2026-05-03",
    "2026-05-04",
    "2026-05-05",
    "2026-06-19",
    "2026-06-20",
    "2026-06-21",
    "2026-09-25",
    "2026-09-26",
    "2026-09-27",
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
    "2026-10-04",
    "2026-10-05",
    "2026-10-06",
    "2026-10-07",
  ],
  validUntil: "2026-12-31",
  source: "https://timor.tech/api/holiday/year/2026",
  retrievedAt: "2026-10-27",
}

const PEAK_WINDOWS = [
  { days: [1, 2, 3, 4, 5], from: "01:00", to: "04:00" },
  { days: [1, 2, 3, 4, 5], from: "06:00", to: "10:00" },
] as const

export const DEEPSEEK_TARIFF: Tariff = {
  id: "deepseek",
  label: "DeepSeek",
  providers: ["deepseek", "opencode-go"],
  windowsUTC: PEAK_WINDOWS,
  peakMultiplier: 2,
  holidays: DEEPSEEK_HOLIDAYS_2026,
  sourceURL: DEEPSEEK_SOURCE,
  pricesAsOf: PRICES_AS_OF,
  models: {
    "deepseek-flash": {
      aliases: [
        "deepseek-v4-flash",
        "deepseek-v4-flash-vision-exp",
        "deepseek-v4.1-flash",
        "deepseek-flash-1017",
      ],
      prices: {
        peak: { input: 0.3, output: 1.2, cacheRead: 0.006 },
        offPeak: { input: 0.15, output: 0.6, cacheRead: 0.003 },
      },
    },
    "deepseek-v4-pro": {
      aliases: ["deepseek-v4-pro-0813", "deepseek-v4.1-pro"],
      prices: {
        peak: { input: 1.32, output: 3.96, cacheRead: 0.044 },
        offPeak: { input: 0.66, output: 1.98, cacheRead: 0.022 },
      },
    },
  },
}

export interface HolidayOverride {
  readonly dates: readonly string[]
  readonly validUntil: string
  readonly source?: string
  readonly retrievedAt?: string
}

function isCalendar(value: unknown): value is HolidayOverride {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return (
    Array.isArray(candidate.dates) &&
    candidate.dates.every((date) => typeof date === "string") &&
    typeof candidate.validUntil === "string"
  )
}

export function buildTariff(
  options: Readonly<Record<string, unknown>> | undefined,
  override?: unknown,
): Tariff {
  const providers = options?.providers
  const holidays = options?.holidays

  const base: Tariff = {
    ...DEEPSEEK_TARIFF,
    providers:
      Array.isArray(providers) && providers.every((value) => typeof value === "string")
        ? (providers as string[])
        : DEEPSEEK_TARIFF.providers,
    holidays: isCalendar(holidays)
      ? {
          dates: holidays.dates,
          validUntil: holidays.validUntil,
          source: holidays.source,
          retrievedAt: holidays.retrievedAt,
        }
      : DEEPSEEK_TARIFF.holidays,
  }

  if (!isCalendar(override)) return base

  // A stored refresh wins only when it is at least as fresh as the bundled one.
  const bundledUntil = base.holidays?.validUntil ?? ""
  if (override.validUntil < bundledUntil) return base

  return {
    ...base,
    holidays: {
      dates: override.dates,
      validUntil: override.validUntil,
      source: override.source ?? "refresh",
      retrievedAt: override.retrievedAt,
    },
  }
}

/**
 * Accepts either { dates: [...], validUntil } or the timor.tech shape
 * ({ holiday: { "MM-DD": { holiday: true, date: "YYYY-MM-DD" } } }).
 */
export function normalizeHolidayPayload(
  payload: unknown,
  year: number,
): HolidayOverride | null {
  if (!payload || typeof payload !== "object") return null
  const record = payload as Record<string, unknown>

  if (isCalendar(record)) {
    return {
      dates: record.dates,
      validUntil: record.validUntil,
      source: record.source,
      retrievedAt: record.retrievedAt ?? new Date().toISOString().slice(0, 10),
    }
  }

  const table = record.holiday
  if (table && typeof table === "object") {
    const dates: string[] = []
    for (const value of Object.values(table as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue
      const entry = value as Record<string, unknown>
      if (entry.holiday !== true) continue
      if (typeof entry.date === "string" && entry.date.startsWith(`${year}-`)) dates.push(entry.date)
    }
    if (dates.length > 0) {
      return {
        dates: dates.sort(),
        validUntil: `${year}-12-31`,
        source: "timor.tech",
        retrievedAt: new Date().toISOString().slice(0, 10),
      }
    }
  }

  return null
}
