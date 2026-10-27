import { Plugin } from "@opencode/plugin"
import { buildTariff } from "./data.js"
import { TariffRpc } from "./rpc.js"
import { resolveTier, type TierState } from "./tariff.js"

interface StatusInput {
  readonly providerID: string
  readonly modelID: string
  readonly at?: number
}

interface HolidayInput {
  readonly dates: readonly string[]
  readonly validUntil: string
  readonly source?: string
}

/** Storage accepts JSON only; this also drops undefined fields. */
function jsonClone(value: unknown): any {
  return JSON.parse(JSON.stringify(value))
}

function statusPayload(state: TierState | null, peakMultiplier: number) {
  if (!state) return { matched: false }
  return {
    matched: true,
    tariffID: state.tariffID,
    tariffLabel: state.tariffLabel,
    modelKey: state.modelKey,
    tier: state.tier,
    reason: state.reason,
    nextChangeAt: state.nextChangeAt ?? undefined,
    confidence: state.confidence,
    peakMultiplier,
    ...(state.prices ? { prices: state.prices } : {}),
  }
}

export default Plugin.define({
  id: "tariff.pulse",
  async setup(ctx) {
    let tariff = buildTariff(ctx.options, await ctx.storage.get("holidays").catch(() => undefined))

    await ctx.rpc.register(TariffRpc, {
      async status(input) {
        const { providerID, modelID, at } = input as StatusInput
        const moment = new Date(at ?? Date.now())
        return statusPayload(resolveTier(moment, tariff, providerID, modelID), tariff.peakMultiplier)
      },

      async setHolidays(input) {
        const { dates, validUntil, source } = input as HolidayInput
        const clean = [...new Set(dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort()
        if (clean.length === 0) return { ok: false, count: 0 }

        await ctx.storage.set("holidays", jsonClone({ dates: clean, validUntil, source }))
        tariff = buildTariff(ctx.options, { dates: clean, validUntil, source })
        return { ok: true, count: clean.length }
      },

      async schedule() {
        return {
          tariffID: tariff.id,
          label: tariff.label,
          providers: [...tariff.providers],
          peakMultiplier: tariff.peakMultiplier,
          ...(tariff.pricesAsOf ? { pricesAsOf: tariff.pricesAsOf } : {}),
          ...(tariff.sourceURL ? { sourceURL: tariff.sourceURL } : {}),
          windows: tariff.windowsUTC.map((window) => ({
            days: [...window.days],
            from: window.from,
            to: window.to,
          })),
          ...(tariff.holidays
            ? {
                holidays: {
                  count: tariff.holidays.dates.length,
                  validUntil: tariff.holidays.validUntil,
                  ...(tariff.holidays.source ? { source: tariff.holidays.source } : {}),
                },
              }
            : {}),
        }
      },
    })
  },
})
