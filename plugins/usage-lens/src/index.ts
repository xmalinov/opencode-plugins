import { Plugin } from "@opencode/plugin"
import { forecast, pushPoint, usageText, type UsagePoint } from "./forecast.js"
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

    // The panel records readings only while the TUI is open, so the age of the last
    // one is part of the answer.
    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "usage", description: "Allowance, budgets and forecast" })
      editor.add({
        name: "forecast",
        description:
          "Monthly, weekly and 5-hour allowance percentages from the panel's last reading, the measured burn rate and the time to the limit at that rate. Says how old the reading is.",
        input: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        options: { namespace: "usage" },
        async execute() {
          return { content: usageText(points, Date.now()) }
        },
      })
    })
  },
})
