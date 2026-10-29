import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { buildTariff, normalizeHolidayPayload } from "./data.js"
import { TariffRpc } from "./rpc.js"
import {
  discountPercent,
  formatClock,
  formatPrice,
  formatShort,
  hasFreshCalendar,
  resolveTier,
  type ModelTariff,
  type TierState,
} from "./tariff.js"

const DEFAULT_HOLIDAY_URL = "https://timor.tech/api/holiday/year"
const TEST_PEAK = Date.UTC(2026, 9, 27, 2, 0, 0)
const TEST_OFF_PEAK = Date.UTC(2026, 9, 27, 12, 0, 0)

/** A stalled call must not leave `/tier refresh` silent for ever. */
const RPC_TIMEOUT_MS = 15_000
const FETCH_TIMEOUT_MS = 10_000

/** Used only when the active theme defines none of the semantic tokens. */
const FALLBACK_GREEN = "#3fb950"
const FALLBACK_YELLOW = "#d29922"

function withTimeout<T>(promise: Promise<T>, ms = RPC_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms),
    ),
  ])
}

/** First path the theme actually defines: a theme is not required to carry the feedback tokens. */
function themeColour(theme: any, ...paths: string[][]): any {
  for (const path of paths) {
    let node: any = theme
    for (const key of path) node = node?.[key]
    if (node !== undefined && node !== null) return node
  }
  return undefined
}

export default Plugin.define({
  id: "tariff.pulse.cli",
  setup(context) {
    const options = context.options as Record<string, unknown>
    const nearMinutes =
      typeof options.nearChangeMinutes === "number" ? options.nearChangeMinutes : 15
    const nearMs = nearMinutes * 60_000

    const muted = context.theme.text.muted
    const success =
      themeColour(
        context.theme,
        ["text", "feedback", "success", "base"],
        ["syntax", "string"],
        ["diff", "text", "added"],
      ) ?? FALLBACK_GREEN
    const warning =
      themeColour(
        context.theme,
        ["text", "feedback", "warning", "base"],
        ["syntax", "type"],
        ["syntax", "number"],
      ) ?? FALLBACK_YELLOW

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
      if (state.tier === "offPeak") return success
      if (state.nextChangeAt !== null && state.nextChangeAt - now() <= nearMs) {
        return warning
      }
      return muted
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
      if (!view) return <text fg={muted}>No tariff for the selected model</text>
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
      if (!view) return <text fg={muted}>Provider or model is outside the tariff.</text>

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

      return <text fg={muted}>{lines.join("\n")}</text>
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

    const refresh = async (quiet = false) => {
      const year = new Date().getFullYear()
      const url =
        typeof options.holidayURL === "string"
          ? options.holidayURL
          : `${DEFAULT_HOLIDAY_URL}/${year}`
      try {
        const response = await fetch(url, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const payload = normalizeHolidayPayload(await response.json(), year)
        if (!payload) throw new Error("unrecognized calendar payload")

        await setHolidays((draft) => {
          draft.dates = [...payload.dates]
          draft.validUntil = payload.validUntil
          draft.source = payload.source ?? url
          draft.retrievedAt = payload.retrievedAt ?? ""
        })

        // Plugin RPCs are scoped to a location: without one the server answers
        // `rpc.unavailable` and the refreshed calendar never reaches it.
        const directory = (context.location ?? context.data.location.default())?.directory
        let syncError: string | null = directory ? null : "no location"
        if (directory) {
          try {
            await withTimeout(
              context.client.rpc(TariffRpc).setHolidays(
                {
                  dates: [...payload.dates],
                  validUntil: payload.validUntil,
                  source: payload.source ?? url,
                },
                { location: { directory } },
              ),
            )
          } catch (error) {
            syncError = (error as Error).message
          }
        }

        // The badge reads the TUI copy, so a failed sync is not fatal — but do
        // not report success when only the local calendar was updated.
        if (!quiet) {
          context.ui.toast.show(
            syncError
              ? {
                  message: `Holiday calendar updated locally (${payload.dates.length} days); server sync failed: ${syncError}`,
                  variant: "warning",
                }
              : {
                  message: `Holiday calendar updated: ${payload.dates.length} days`,
                  variant: "success",
                },
          )
        } else if (syncError) {
          console.error(`[tariff-pulse] calendar refreshed, server sync failed: ${syncError}`)
        }
      } catch (error) {
        // A background attempt is not an action: no toast, just the log.
        if (quiet) {
          console.error(`[tariff-pulse] calendar refresh failed: ${(error as Error).message}`)
          return
        }
        context.ui.toast.show({
          message: `Calendar refresh failed: ${(error as Error).message}`,
          variant: "error",
        })
      }
    }

    // The bundled calendar expires, and after that the badge stays at `▲?` until
    // someone remembers `/tier refresh`. Refresh it in the background, but only
    // when it is actually stale, so a launch in normal times makes no request.
    if (options.autoHolidays !== false && !hasFreshCalendar(tariff().holidays, new Date())) {
      void refresh(true)
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
