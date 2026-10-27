import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { buildTariff, normalizeHolidayPayload } from "./data.js"
import { TariffRpc } from "./rpc.js"
import {
  discountPercent,
  formatClock,
  formatPrice,
  formatShort,
  resolveTier,
  type ModelTariff,
  type TierState,
} from "./tariff.js"

const DEFAULT_HOLIDAY_URL = "https://timor.tech/api/holiday/year"
const TEST_PEAK = Date.UTC(2026, 9, 27, 2, 0, 0)
const TEST_OFF_PEAK = Date.UTC(2026, 9, 27, 12, 0, 0)

export default Plugin.define({
  id: "tariff.pulse.cli",
  setup(context) {
    const options = context.options as Record<string, unknown>
    const nearMinutes =
      typeof options.nearChangeMinutes === "number" ? options.nearChangeMinutes : 15
    const nearMs = nearMinutes * 60_000

    const [tick, setTick] = createSignal(Date.now())
    const [sim, setSim] = context.storage.store("sim", { initial: { at: 0 } })
    const [holidays, setHolidays] = context.storage.store("holidays", {
      initial: { dates: [] as string[], validUntil: "", source: "", retrievedAt: "" },
    })
    const [back, setBack] = createSignal<ReturnType<typeof context.ui.router.current> | null>(null)

    const now = () => (sim.at > 0 ? sim.at : tick())
    const tariff = () =>
      buildTariff(
        options,
        holidays.validUntil
          ? {
              dates: [...holidays.dates],
              validUntil: holidays.validUntil,
              source: holidays.source,
              retrievedAt: holidays.retrievedAt,
            }
          : undefined,
      )

    const current = (): { state: TierState; model: ModelTariff } | null => {
      const model = context.ui.model.current()
      if (!model) return null
      const config = tariff()
      const state = resolveTier(new Date(now()), config, model.providerID, model.modelID)
      if (!state) return null
      return { state, model: config.models[state.modelKey] }
    }

    const onPage = () => {
      const route = context.ui.router.current()
      return route.type === "plugin" && route.name === "tariff"
    }

    const openPage = () => {
      const route = context.ui.router.current()
      if (route.type !== "plugin") setBack(route)
      context.ui.router.navigate({ type: "plugin", name: "tariff" })
    }

    const goBack = () => {
      const route = back()
      setBack(null)
      context.ui.router.navigate(route ?? { type: "home" })
    }

    const color = (state: TierState) => {
      if (state.tier === "offPeak") return context.theme.text.feedback.success.base
      if (state.nextChangeAt !== null && state.nextChangeAt - now() <= nearMs) {
        return context.theme.text.feedback.warning.base
      }
      return context.theme.text.muted
    }

    const badge = () => {
      const view = current()
      if (!view) return <box />
      const { state } = view
      const config = tariff()
      const countdown = state.nextChangeAt === null ? null : state.nextChangeAt - now()
      const glyph = state.confidence === "exact" ? (state.tier === "offPeak" ? "▼" : "▲") : "▲?"
      const label =
        state.tier === "offPeak"
          ? `OFF −${discountPercent(config)}%`
          : `PEAK ×${config.peakMultiplier}`
      const test = sim.at > 0 ? "TEST " : ""
      return <text fg={color(state)}>{`${test}${glyph} ${label} · ${formatShort(countdown)}`}</text>
    }

    const header = () => {
      const view = current()
      if (!view) return <text fg={context.theme.text.muted}>No tariff for the selected model</text>
      const { state } = view
      const config = tariff()
      const label =
        state.tier === "offPeak"
          ? `OFF-PEAK −${discountPercent(config)}%`
          : `PEAK ×${config.peakMultiplier}`
      const test = sim.at > 0 ? "  (test clock)" : ""
      return <text fg={color(state)}>{`${label} · ${state.tariffLabel} · ${state.modelKey}${test}`}</text>
    }

    const body = () => {
      const view = current()
      if (!view) return <text fg={context.theme.text.muted}>Provider or model is outside the tariff.</text>

      const { state, model } = view
      const config = tariff()
      const lines: string[] = []

      lines.push(
        `until ${formatClock(state.nextChangeAt)} local · in ${formatShort(
          state.nextChangeAt === null ? null : state.nextChangeAt - now(),
        )}`,
      )

      if (model.prices) {
        const active = model.prices[state.tier]
        const other = state.tier === "peak" ? model.prices.offPeak : model.prices.peak
        lines.push(
          `now      input $${formatPrice(active.input)} · cache $${formatPrice(
            active.cacheRead,
          )} · output $${formatPrice(active.output)} / 1M`,
        )
        lines.push(
          `next     input $${formatPrice(other.input)} · cache $${formatPrice(
            other.cacheRead,
          )} · output $${formatPrice(other.output)} / 1M`,
        )
      }

      const windows = config.windowsUTC.map((window) => `${window.from}-${window.to}`).join(", ")
      lines.push(`schedule ${windows} UTC · Mon-Fri`)
      lines.push(
        `holidays ${config.holidays?.dates.length ?? 0} days · valid until ${
          config.holidays?.validUntil ?? "—"
        }`,
      )

      if (state.confidence !== "exact") {
        lines.push("! holiday calendar is not fresh: peak may actually be off-peak")
      }

      lines.push(`prices as of ${config.pricesAsOf ?? "—"} · ${config.sourceURL ?? "no source"}`)
      lines.push("")
      lines.push("esc / q — back · /tier refresh — calendar")
      lines.push("/tier test peak | off | live — preview colors")

      return <text fg={context.theme.text.muted}>{lines.join("\n")}</text>
    }

    const unregisterRoute = context.ui.router.register({
      name: "tariff",
      render: () => (
        <box flexDirection="column">
          {header()}
          {body()}
        </box>
      ),
    })

    const unregisterSlot = context.ui.slot({
      append: "prompt.footer.status",
      render: badge,
    })

    const refresh = async () => {
      const year = new Date().getFullYear()
      const url =
        typeof options.holidayURL === "string"
          ? options.holidayURL
          : `${DEFAULT_HOLIDAY_URL}/${year}`
      try {
        const response = await fetch(url, { headers: { accept: "application/json" } })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const payload = normalizeHolidayPayload(await response.json(), year)
        if (!payload) throw new Error("unrecognized calendar payload")

        await setHolidays((draft) => {
          draft.dates = [...payload.dates]
          draft.validUntil = payload.validUntil
          draft.source = payload.source ?? url
          draft.retrievedAt = payload.retrievedAt ?? ""
        })

        await context.client
          .rpc(TariffRpc)
          .setHolidays({
            dates: [...payload.dates],
            validUntil: payload.validUntil,
            source: payload.source ?? url,
          })
          .catch(() => undefined)

        context.ui.toast.show({
          message: `Holiday calendar updated: ${payload.dates.length} days`,
          variant: "success",
        })
      } catch (error) {
        context.ui.toast.show({
          message: `Calendar refresh failed: ${(error as Error).message}`,
          variant: "error",
        })
      }
    }

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "tariff.pulse.show",
          title: "Tariff: current tier and schedule",
          description: "DeepSeek peak/off-peak price window",
          group: "Tariff",
          palette: true,
          slash: { name: "tier", aliases: ["tariff"], arguments: true },
          run: (input) => {
            const argument = (input ?? "").trim().toLowerCase()
            if (argument === "refresh") return refresh()
            if (argument === "test peak") {
              setSim((draft) => {
                draft.at = TEST_PEAK
              })
              openPage()
              return
            }
            if (argument === "test off" || argument === "test offpeak") {
              setSim((draft) => {
                draft.at = TEST_OFF_PEAK
              })
              openPage()
              return
            }
            if (argument === "test live") {
              setSim((draft) => {
                draft.at = 0
              })
              openPage()
              return
            }
            if (onPage()) goBack()
            else openPage()
            return
          },
        },
      ],
    }))

    context.keymap.layer(() => ({
      mode: "global",
      priority: 30,
      enabled: onPage,
      commands: [
        {
          id: "tariff.pulse.back",
          title: "Tariff: back",
          bind: "escape",
          run: goBack,
        },
        {
          id: "tariff.pulse.back.q",
          title: "Tariff: back (q)",
          bind: "q",
          run: goBack,
        },
      ],
    }))

    const timer = setInterval(() => setTick(Date.now()), 10_000)

    return () => {
      clearInterval(timer)
      unregisterSlot()
      unregisterRoute()
    }
  },
})
