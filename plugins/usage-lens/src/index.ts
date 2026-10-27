import { Plugin } from "@opencode/plugin"
import { forecast, pushPoint, type UsagePoint } from "./forecast.js"
import { UsageRpc } from "./rpc.js"

function readPoints(value: unknown): UsagePoint[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is UsagePoint =>
      !!item &&
      typeof item === "object" &&
      typeof (item as UsagePoint).t === "number" &&
      typeof (item as UsagePoint).monthly === "number",
  )
}

/** Storage accepts JSON only. */
function jsonClone(value: unknown): any {
  return JSON.parse(JSON.stringify(value))
}

function forecastPayload(points: readonly UsagePoint[]) {
  const result = forecast(points)
  if (!result) return undefined
  return {
    ratePerHour: result.ratePerHour,
    ...(result.etaDays === null ? {} : { etaDays: result.etaDays }),
    spanHours: result.spanHours,
    points: result.points,
    confidence: result.confidence,
  }
}

export default Plugin.define({
  id: "usage.lens",
  async setup(ctx) {
    let points = readPoints(await ctx.storage.get("points").catch(() => undefined))

    await ctx.rpc.register(UsageRpc, {
      async ingest(input) {
        const { point } = input as { point: UsagePoint }
        points = pushPoint(points, point)
        await ctx.storage.set("points", jsonClone(points))

        const payload = forecastPayload(points)
        return { ok: true, points: points.length, ...(payload ? { forecast: payload } : {}) }
      },

      async history() {
        const payload = forecastPayload(points)
        return { points: points.length, ...(payload ? { forecast: payload } : {}) }
      },

      async reset() {
        points = []
        await ctx.storage.remove("points")
        return { ok: true, points: 0 }
      },
    })
  },
})
