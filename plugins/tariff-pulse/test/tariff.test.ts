/// <reference types="node" />
import assert from "node:assert/strict"
import { test } from "node:test"
import { DEEPSEEK_HOLIDAYS_2026, buildTariff, normalizeHolidayPayload } from "../src/data.ts"
import {
  beijingDate,
  discountPercent,
  findModel,
  formatClock,
  formatPrice,
  formatShort,
  hasFreshCalendar,
  isHoliday,
  modelKey,
  nextTierChange,
  resolveTier,
  statusText,
  tierAt,
  type Tariff,
} from "../src/tariff.ts"

const tariff = buildTariff(undefined, undefined)
const at = (iso: string) => new Date(iso)
const tierOf = (iso: string) => tierAt(at(iso), tariff)
const nextChange = (iso: string, current: "peak" | "offPeak") => {
  const next = nextTierChange(at(iso), tariff, current)
  return next === null ? null : new Date(next).toISOString()
}

test("weekday peak windows follow the UTC schedule", () => {
  assert.equal(tierOf("2026-10-26T00:59:59Z"), "offPeak")
  assert.equal(tierOf("2026-10-26T01:00:00Z"), "peak")
  assert.equal(tierOf("2026-10-26T03:59:59Z"), "peak")
  assert.equal(tierOf("2026-10-26T04:00:00Z"), "offPeak")
  assert.equal(tierOf("2026-10-26T05:59:59Z"), "offPeak")
  assert.equal(tierOf("2026-10-26T06:00:00Z"), "peak")
  assert.equal(tierOf("2026-10-26T09:59:59Z"), "peak")
  assert.equal(tierOf("2026-10-26T10:00:00Z"), "offPeak")
})

test("weekends are off-peak all day", () => {
  assert.equal(tierOf("2026-10-31T02:00:00Z"), "offPeak")
  assert.equal(tierOf("2026-11-01T07:00:00Z"), "offPeak")
})

test("a fresh calendar makes PRC holidays off-peak inside a peak window", () => {
  const state = resolveTier(
    at("2026-10-01T02:00:00Z"),
    tariff,
    "opencode-go",
    "deepseek-v4.1-flash",
  )
  assert.equal(state?.tier, "offPeak")
  assert.equal(state?.reason, "holiday")
})

test("holiday boundaries follow Beijing midnight, not UTC midnight", () => {
  assert.equal(beijingDate(at("2026-09-30T15:59:59Z")), "2026-09-30")
  assert.equal(beijingDate(at("2026-09-30T16:00:00Z")), "2026-10-01")
  assert.equal(isHoliday(at("2026-09-30T15:59:59Z"), tariff.holidays), false)
  assert.equal(isHoliday(at("2026-09-30T16:00:00Z"), tariff.holidays), true)
})

test("a calendar is fresh through the Beijing date in validUntil", () => {
  assert.equal(hasFreshCalendar(tariff.holidays, at("2026-10-28T00:00:00Z")), true)
  assert.equal(hasFreshCalendar(tariff.holidays, at("2026-12-30T16:00:00Z")), true) // Beijing 2026-12-31
  assert.equal(hasFreshCalendar(tariff.holidays, at("2026-12-31T16:00:00Z")), false) // Beijing 2027-01-01
  assert.equal(hasFreshCalendar(null, at("2026-10-28T00:00:00Z")), false)
})

test("an expired calendar degrades to weekday-only and ignores holidays", () => {
  const stale: Tariff = {
    ...tariff,
    holidays: { dates: ["2026-10-01"], validUntil: "2025-12-31" },
  }
  assert.equal(tierAt(at("2026-10-01T02:00:00Z"), stale), "peak")

  const state = resolveTier(at("2026-10-01T02:00:00Z"), stale, "opencode-go", "deepseek-v4.1-flash")
  assert.equal(state?.tier, "peak")
  assert.equal(state?.confidence, "weekday-only")
})

test("next change inside a peak window is that window's end", () => {
  assert.equal(nextChange("2026-10-27T02:00:00Z", "peak"), "2026-10-27T04:00:00.000Z")
  assert.equal(nextChange("2026-10-27T03:59:30Z", "peak"), "2026-10-27T04:00:00.000Z")
  assert.equal(nextChange("2026-10-27T07:00:00Z", "peak"), "2026-10-27T10:00:00.000Z")
})

test("next change outside a window is the following window's start", () => {
  assert.equal(nextChange("2026-10-26T04:30:00Z", "offPeak"), "2026-10-26T06:00:00.000Z")
  assert.equal(nextChange("2026-10-26T10:00:00Z", "offPeak"), "2026-10-27T01:00:00.000Z")
})

test("next change skips the weekend", () => {
  assert.equal(nextChange("2026-10-30T10:00:00Z", "offPeak"), "2026-11-02T01:00:00.000Z")
})

test("next change skips every window inside a holiday", () => {
  assert.equal(nextChange("2026-10-02T00:30:00Z", "offPeak"), "2026-10-08T01:00:00.000Z")
})

test("prices follow the active tier", () => {
  const peak = resolveTier(at("2026-10-27T02:00:00Z"), tariff, "opencode-go", "deepseek-v4.1-flash")
  const offPeak = resolveTier(at("2026-10-27T12:00:00Z"), tariff, "opencode-go", "deepseek-v4.1-flash")
  assert.deepEqual(peak?.prices, { input: 0.3, output: 1.2, cacheRead: 0.006 })
  assert.deepEqual(offPeak?.prices, { input: 0.15, output: 0.6, cacheRead: 0.003 })
})

test("every known model prices off-peak at exactly half of peak", () => {
  for (const [key, model] of Object.entries(tariff.models)) {
    const prices = model.prices
    assert.ok(prices, `${key} has no prices`)
    assert.equal(prices.offPeak.input * 2, prices.peak.input, `${key} input`)
    assert.equal(prices.offPeak.output * 2, prices.peak.output, `${key} output`)
    assert.equal(prices.offPeak.cacheRead * 2, prices.peak.cacheRead, `${key} cache`)
  }
})

test("paid model aliases are matched case-insensitively, free variants are not", () => {
  assert.equal(findModel(tariff, "deepseek-v4.1-flash")?.[0], "deepseek-flash")
  assert.equal(findModel(tariff, "DeepSeek-V4.1-Flash")?.[0], "deepseek-flash")
  assert.equal(findModel(tariff, "deepseek-v4-pro")?.[0], "deepseek-v4-pro")
  assert.equal(findModel(tariff, "deepseek-v4.1-flash-free"), null)
  assert.equal(findModel(tariff, "gpt-5"), null)
})

test("model keys fold case, punctuation and a snapshot stamp", () => {
  assert.equal(modelKey("DeepSeek V4.1 Flash"), "deepseek-v4-1-flash")
  assert.equal(modelKey("deepseek--flash__1017"), "deepseek-flash")
  assert.equal(modelKey("--"), "")
  // Labels stay: `-free` is another tariff, not another name for this one.
  assert.equal(modelKey("deepseek-v4.1-flash-free"), "deepseek-v4-1-flash-free")
  // A stamp is not stripped when it would leave a name too short to be a model.
  assert.equal(modelKey("abc-1017"), "abc-1017")
})

test("a new snapshot of a known model resolves without a new alias", () => {
  assert.equal(findModel(tariff, "deepseek-flash-1201")?.[0], "deepseek-flash")
  assert.equal(findModel(tariff, "deepseek-v4-pro-1201")?.[0], "deepseek-v4-pro")
  // The catalogue's own spelling meets the provider id.
  assert.equal(findModel(tariff, "DeepSeek V4.1 Flash 1017")?.[0], "deepseek-flash")
  const state = resolveTier(at("2026-10-27T02:00:00Z"), tariff, "opencode-go", "deepseek-flash-1201")
  assert.equal(state?.modelKey, "deepseek-flash")
  assert.equal(state?.tier, "peak")
})

test("normalization does not fuse models or pull in free variants", () => {
  assert.equal(findModel(tariff, "deepseek-v4-pro-free"), null)
  assert.equal(findModel(tariff, "deepseek-flash-free"), null)
  assert.equal(findModel(tariff, "deepseek-chat"), null)
  assert.equal(findModel(tariff, "gpt-4-0613"), null)
})

test("providers and models outside the tariff are not resolved", () => {
  const moment = at("2026-10-27T02:00:00Z")
  assert.equal(resolveTier(moment, tariff, "cloudflare-workers-ai", "deepseek-v4.1-flash"), null)
  assert.equal(resolveTier(moment, tariff, "opencode-go", "deepseek-v4.1-flash-free"), null)
})

test("options.providers replaces the default provider list", () => {
  const custom = buildTariff({ providers: ["acme"] })
  assert.deepEqual(custom.providers, ["acme"])
  assert.equal(
    resolveTier(at("2026-10-27T02:00:00Z"), custom, "opencode-go", "deepseek-v4.1-flash"),
    null,
  )
})

test("invalid options keep the bundled defaults", () => {
  const broken = buildTariff({ providers: ["acme", 1], holidays: { dates: "nope" } })
  assert.deepEqual(broken.providers, tariff.providers)
  assert.deepEqual(broken.holidays?.dates, DEEPSEEK_HOLIDAYS_2026.dates)
})

test("a stored calendar wins only when it is at least as fresh as the bundled one", () => {
  const same = buildTariff(undefined, { dates: ["2026-12-31"], validUntil: "2026-12-31" })
  assert.deepEqual(same.holidays?.dates, ["2026-12-31"])

  const newer = buildTariff(undefined, {
    dates: ["2027-01-01"],
    validUntil: "2027-12-31",
    source: "timor.tech",
  })
  assert.deepEqual(newer.holidays?.dates, ["2027-01-01"])
  assert.equal(newer.holidays?.source, "timor.tech")

  const older = buildTariff(undefined, { dates: ["2025-01-01"], validUntil: "2025-12-31" })
  assert.deepEqual(older.holidays?.dates, DEEPSEEK_HOLIDAYS_2026.dates)
})

test("timor.tech payloads are normalized to holiday dates", () => {
  const payload = normalizeHolidayPayload(
    {
      code: 0,
      holiday: {
        "01-01": { holiday: true, name: "New Year", date: "2027-01-01" },
        "01-02": { holiday: false, name: "make-up workday", date: "2027-01-02" },
        "01-03": { holiday: true, name: "other year", date: "2026-01-03" },
      },
    },
    2027,
  )
  assert.deepEqual(payload?.dates, ["2027-01-01"])
  assert.equal(payload?.validUntil, "2027-12-31")
  assert.equal(payload?.source, "timor.tech")
})

test("a plain calendar payload is accepted as is", () => {
  const payload = normalizeHolidayPayload(
    { dates: ["2027-05-01"], validUntil: "2027-12-31", source: "manual" },
    2027,
  )
  assert.deepEqual(payload?.dates, ["2027-05-01"])
  assert.equal(payload?.validUntil, "2027-12-31")
  assert.equal(payload?.source, "manual")
})

test("unrecognized payloads are rejected", () => {
  assert.equal(normalizeHolidayPayload(null, 2027), null)
  assert.equal(normalizeHolidayPayload({ foo: 1 }, 2027), null)
  assert.equal(normalizeHolidayPayload({ holiday: { "01-01": { holiday: false } } }, 2027), null)
})

test("formatShort renders compact countdowns", () => {
  assert.equal(formatShort(null), "—")
  assert.equal(formatShort(20_000), "now")
  assert.equal(formatShort(30_000), "now")
  assert.equal(formatShort(30_001), "1m")
  assert.equal(formatShort(42 * 60_000), "42m")
  assert.equal(formatShort(102 * 60_000), "1h 42m")
  assert.equal(formatShort(2 * 60 * 60_000), "2h")
  assert.equal(formatShort(2 * 1440 * 60_000 + 4 * 60 * 60_000), "2d 4h")
  assert.equal(formatShort(3 * 1440 * 60_000), "3d")
})

test("formatPrice keeps sub-cent cache prices readable", () => {
  assert.equal(formatPrice(0), "0")
  assert.equal(formatPrice(0.003), "0.003")
  assert.equal(formatPrice(0.006), "0.006")
  assert.equal(formatPrice(0.15), "0.15")
  assert.equal(formatPrice(1.2), "1.20")
})

test("formatClock prints the local time of a timestamp", () => {
  const stamp = Date.UTC(2026, 9, 27, 2, 0, 0)
  const local = new Date(stamp)
  const expected = `${String(local.getHours()).padStart(2, "0")}:${String(
    local.getMinutes(),
  ).padStart(2, "0")}`
  assert.equal(formatClock(stamp), expected)
  assert.equal(formatClock(null), "—")
})

test("discountPercent derives the off-peak discount from the multiplier", () => {
  assert.equal(discountPercent(tariff), 50)
  assert.equal(discountPercent({ ...tariff, peakMultiplier: 1 }), 0)
  assert.equal(discountPercent({ ...tariff, peakMultiplier: 4 }), 75)
})

test("statusText names the tier, the next change and both price lists", () => {
  const moment = at("2026-10-27T02:00:00Z")
  const state = resolveTier(moment, tariff, "opencode-go", "deepseek-v4.1-flash")
  assert.ok(state)
  const text = statusText(tariff, state, moment.getTime())

  assert.match(text, /^PEAK ×2 · DeepSeek · deepseek-flash$/m)
  assert.match(text, /^reason window · next change .+ local · in 2h$/m)
  assert.match(text, /^now {3}input \$0\.3 · cache \$0\.006 · output \$1\.20 \/ 1M$/m)
  assert.match(text, /^next {2}input \$0\.15 · cache \$0\.003 · output \$0\.6 \/ 1M$/m)
  assert.match(text, /^schedule 01:00–04:00, 06:00–10:00 UTC, Mon–Fri$/m)
  assert.match(text, /^PRC holidays off-peak \(\d+ days, valid until 2026-12-31\)$/m)
  assert.doesNotMatch(text, /warning/)
})

test("statusText on a stale calendar admits the uncertainty", () => {
  const stale: Tariff = {
    ...tariff,
    holidays: { dates: ["2026-10-01"], validUntil: "2025-12-31" },
  }
  const moment = at("2026-10-01T02:00:00Z")
  const state = resolveTier(moment, stale, "opencode-go", "deepseek-v4.1-flash")

  assert.match(statusText(stale, state, moment.getTime()), /^PEAK/m)
  assert.match(
    statusText(stale, state, moment.getTime()),
    /warning: the holiday calendar is stale, so peak may actually be off-peak/,
  )
})

test("statusText lists what the tariff covers when the model is outside it", () => {
  const text = statusText(tariff, null, Date.UTC(2026, 9, 27))

  assert.match(text, /^DeepSeek: this model is outside the tariff\.$/m)
  assert.match(text, /providers deepseek, opencode-go/)
  assert.match(text, /models deepseek-flash, deepseek-v4-pro/)
  assert.match(text, /^schedule /m)
})

test("the bundled holiday calendar is still in date", () => {
  assert.ok(
    hasFreshCalendar(tariff.holidays, new Date()),
    "the bundled PRC holiday calendar has expired: update src/data.ts with the next year's dates",
  )
})
