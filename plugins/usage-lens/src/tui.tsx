import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import {
  DAY,
  bar,
  cyclePace,
  cycleStart,
  forecast,
  formatMoney,
  formatSpan,
  formatTokens,
  meterColor,
  pushPoint,
  type UsagePoint,
} from "./forecast.js"
import { budgetBasis, budgetLabel, budgetPercent, pickBudget, type Budget } from "./budget.js"
import { UsageRpc } from "./rpc.js"

interface Meter {
  readonly percent: number
  readonly limited: boolean
  readonly resetsAt: number
}

interface Limits {
  readonly workspace: { readonly id: string; readonly name?: string; readonly usageURL: string }
  readonly go?: { readonly rolling: Meter; readonly weekly: Meter; readonly monthly: Meter }
  readonly budgets: readonly Budget[]
}

interface ModelUsage {
  readonly model: { readonly id: string; readonly providerID: string }
  readonly cost: number
  readonly steps: number
}

interface Stats {
  readonly cost: number
  readonly steps: number
  readonly sessions: number
  readonly tokens: { readonly input: number; readonly output: number }
  readonly models: readonly ModelUsage[]
}

interface Projection {
  readonly kind: "limit" | "spend"
  readonly projected: number
}

/** A stalled call must not leave the panel on old numbers for ever. */
const RPC_TIMEOUT_MS = 15_000

/** A reading older than a few polls is not fresh, and the panel says so. */
const STALE_MS = 5 * 60_000

/** Used only when the active theme defines none of the semantic tokens. */
const FALLBACK_GREEN = "#3fb950"
const FALLBACK_YELLOW = "#d29922"
const FALLBACK_RED = "#f85149"

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
  id: "usage.lens.cli",
  setup(context) {
    const options = context.options as Record<string, unknown>
    const compact = options.compact === true
    const planLabel = typeof options.plan === "string" ? options.plan : undefined

    const [limits, setLimits] = createSignal<Limits | null>(null)
    const [stats, setStats] = createSignal<Stats | null>(null)
    const [month, setMonth] = createSignal<Stats | null>(null)
    const [signedOut, setSignedOut] = createSignal(false)
    const [error, setError] = createSignal<string | null>(null)
    const [updatedAt, setUpdatedAt] = createSignal<number | null>(null)
    const [back, setBack] = createSignal<ReturnType<typeof context.ui.router.current> | null>(null)
    const [points, setPoints] = context.storage.store("points", {
      initial: { items: [] as UsagePoint[] },
    })

    const theme = context.theme
    const muted = theme.text.muted
    const base = theme.text.base
    const feedback = {
      success:
        themeColour(theme, ["text", "feedback", "success", "base"], ["syntax", "string"], ["diff", "text", "added"]) ??
        FALLBACK_GREEN,
      warning:
        themeColour(theme, ["text", "feedback", "warning", "base"], ["syntax", "type"], ["syntax", "number"]) ??
        FALLBACK_YELLOW,
      error:
        themeColour(theme, ["diff", "text", "removed"], ["syntax", "keyword"], ["text", "feedback", "error", "base"]) ??
        FALLBACK_RED,
    }

    let busy = false

    // Plugin RPCs are scoped to a location: without one the server answers
    // `rpc.unavailable` and every snapshot is discarded.
    const rpcOptions = (directory: string | undefined) =>
      directory ? { location: { directory } } : undefined

    const dayStart = () => {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      return start.getTime()
    }

    const monthStart = () => {
      const now = new Date()
      return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    }

    const refresh = async () => {
      if (busy) return
      busy = true
      const location = context.location ?? context.data.location.default()
      const directory = location?.directory
      try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
        const now = Date.now()

        const [limitResult, statsResult, monthResult] = await Promise.allSettled([
          withTimeout(context.client.usage.limits({ location: { directory: location.directory } })),
          withTimeout(
            context.client.session.stats({
              from: dayStart(),
              to: now,
              timezone,
              tools: "none",
            }),
          ),
          withTimeout(
            context.client.session.stats({
              from: monthStart(),
              to: now,
              timezone,
              tools: "none",
            }),
          ),
        ])

        if (limitResult.status === "fulfilled") {
          const data = (limitResult.value.data ?? null) as Limits | null
          setSignedOut(data === null)
          setLimits(data)
          setError(null)
          setUpdatedAt(Date.now())

          if (data?.go) {
            const point: UsagePoint = {
              t: Date.now(),
              monthly: data.go.monthly.percent,
              weekly: data.go.weekly.percent,
              rolling: data.go.rolling.percent,
            }
            const last = points.items[points.items.length - 1]
            if (!last || point.t - last.t >= 5 * 60_000) {
              await setPoints((draft) => {
                draft.items = pushPoint(draft.items, point)
              })
              void context.client
                .rpc(UsageRpc)
                .ingest({ point }, rpcOptions(directory))
                .catch(() => undefined)
            }
          }
        } else {
          setError(
            limitResult.reason instanceof Error ? limitResult.reason.message : "usage API failed",
          )
        }

        if (statsResult.status === "fulfilled") setStats(statsResult.value as Stats)
        if (monthResult.status === "fulfilled") setMonth(monthResult.value as Stats)
      } finally {
        // A rejected call or a storage write must not freeze the panel forever.
        busy = false
      }
    }

    const monthly = () => limits()?.go?.monthly.percent ?? null
    const budgets = () => limits()?.budgets ?? []

    const primaryBudget = (): Budget | undefined =>
      pickBudget(budgets(), context.ui.model.current() ?? null)

    const primaryPercent = () => {
      const item = primaryBudget()
      return item ? budgetPercent(item) : null
    }

    const hasLimits = () => !!limits()?.go || budgets().length > 0

    const meterLine = () => {
      const percent = monthly()
      if (percent === null) {
        const item = primaryBudget()
        if (!item) return "—"
        const value = budgetPercent(item)
        if (value === null) return `$${formatMoney(item.spent)} spent`
        return `${Math.round(value)}% ${bar(value)} · $${formatMoney(budgetBasis(item))}/$${formatMoney(
          item.limit,
        )}`
      }
      const value = Math.round(percent)
      const item = primaryBudget()
      const money = item ? ` · $${formatMoney(item.spent)}/$${formatMoney(item.limit)}` : ""
      return `${value}% ${bar(percent)}${money}`
    }

    const resetLine = () => {
      const go = limits()?.go
      if (!go) {
        const item = primaryBudget()
        if (!item) return ""
        const more = budgets().length > 1 ? ` · ${budgets().length} budgets` : ""
        return `reset ${formatSpan(item.resetsAt - Date.now())}${more}`
      }
      const reset = formatSpan(go.monthly.resetsAt - Date.now())
      return `reset ${reset} · 5h ${Math.round(go.rolling.percent)}% · wk ${Math.round(
        go.weekly.percent,
      )}%`
    }

    const todayLine = () => {
      const value = stats()
      if (!value) return "today —"
      const tokens = formatTokens(value.tokens.input + value.tokens.output)
      return `today $${formatMoney(value.cost)} · ${value.steps} steps · ${tokens}`
    }

    const cyclePoints = () => {
      const go = limits()?.go
      if (!go) return points.items
      // Points from a previous monthly cycle would make the rate negative.
      const start = cycleStart(go.monthly.resetsAt)
      return points.items.filter((point) => point.t >= start)
    }

    const projection = (): Projection | null => {
      const go = limits()?.go
      if (go) {
        // The Console forecasts from the average pace since the start of the
        // period, not from recent snapshots. Match it: a measured 7-day rate
        // produced a completely different "on pace" than the Console.
        const pace = cyclePace(go.monthly.percent, go.monthly.resetsAt, Date.now())
        if (!pace) return null
        return { kind: "limit", projected: pace.projected }
      }

      const value = month()
      if (!value) return null
      const now = Date.now()
      const elapsed = Math.max(0.5, (now - monthStart()) / DAY)
      const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
      return {
        kind: "spend",
        projected: (value.cost / elapsed) * daysInMonth,
      }
    }

    const budgetReached = () => {
      if (limits()?.go) return false
      const item = primaryBudget()
      return !!item && (budgetPercent(item) ?? 0) >= 100
    }

    const paceLine = () => {
      if (limits()?.go?.monthly.limited) return "monthly limit reached"
      if (budgetReached()) return "budget reached"
      const value = projection()
      if (!value) return ""
      if (value.kind === "limit") {
        return `on pace ${Math.round(value.projected)}% by reset`
      }
      return `on pace $${formatMoney(value.projected)}/mo`
    }

    const paceColor = () => {
      if (limits()?.go?.monthly.limited || budgetReached()) return feedback.error
      const value = projection()
      if (!value) return muted
      if (value.kind === "limit" && value.projected > 100) return feedback.warning
      return base
    }

    const plan = () =>
      planLabel ??
      (limits()?.go ? "Go" : budgets().length > 0 ? "Console" : "no plan limits")

    const planLine = () => {
      const item = limits()?.go ? undefined : primaryBudget()
      return item ? `${plan()} · ${budgetLabel(item)}` : plan()
    }

    const summaryColor = () => {
      if (!hasLimits()) return muted
      const percent = monthly() ?? primaryPercent()
      return percent === null ? muted : feedback[meterColor(percent)]
    }

    const staleAge = () => {
      const at = updatedAt()
      if (at === null) return null
      const age = Date.now() - at
      return age > STALE_MS ? age : null
    }

    /** Only when the data is old: a permanent row for the clock would cost more than it explains. */
    const staleLine = () => {
      const age = staleAge()
      const at = updatedAt()
      if (age === null || at === null) return ""
      return `stale ${formatSpan(age)} · last read ${new Date(at).toLocaleTimeString()}`
    }

    const summary = () => {
      // A signed-out read that later failed is a failure, not the old "not connected".
      if (signedOut() && !error()) return <text fg={muted}>usage · not connected</text>
      if (!limits()) {
        return error() ? (
          <text fg={feedback.warning}>
            {compact ? "usage unavailable" : `usage unavailable · ${error()}`}
          </text>
        ) : (
          <text fg={muted}>usage · loading…</text>
        )
      }

      // The last good reading stays on screen when a refresh fails: a blank panel
      // hides exactly what the user opened it for. The failure and the age of the
      // data are printed under the numbers instead.
      const trouble = error() ? <text fg={feedback.warning}>{error()}</text> : null
      const stale = staleLine() ? <text fg={feedback.warning}>{staleLine()}</text> : null

      if (compact) {
        return (
          <text fg={error() || staleAge() !== null ? feedback.warning : summaryColor()}>
            {`usage ${hasLimits() ? meterLine() : "—"}${resetLine() ? ` · ${resetLine()}` : ""}${
              staleAge() !== null ? " · stale" : ""
            }`}
          </text>
        )
      }

      return (
        <box flexDirection="column">
          <text fg={muted}>usage · {planLine()}</text>
          {hasLimits() ? <text fg={summaryColor()}>{meterLine()}</text> : null}
          {paceLine() ? <text fg={paceColor()}>{paceLine()}</text> : null}
          {resetLine() ? <text fg={muted}>{resetLine()}</text> : null}
          <text fg={base}>{todayLine()}</text>
          {stale}
          {trouble}
        </box>
      )
    }

    const onPage = () => {
      const route = context.ui.router.current()
      return route.type === "plugin" && route.name === "usage"
    }

    const openPage = () => {
      const route = context.ui.router.current()
      if (route.type !== "plugin") setBack(route)
      context.ui.router.navigate({ type: "plugin", name: "usage" })
    }

    const goBack = () => {
      const route = back()
      setBack(null)
      context.ui.router.navigate(route ?? { type: "home" })
    }

    const detail = () => {
      const data = limits()
      if (error() && !data) {
        return (
          <box flexDirection="column">
            <text fg={feedback.warning}>Usage API is unavailable</text>
            <text fg={muted}>{error()}</text>
            <text fg={muted}>/limits refresh — retry · esc — back</text>
          </box>
        )
      }
      if (signedOut()) {
        return (
          <box flexDirection="column">
            <text fg={base}>Usage · not connected</text>
            <text fg={muted}>Sign in to the OpenCode Console to see allowance and budgets.</text>
            <text fg={muted}>esc — back</text>
          </box>
        )
      }
      if (!data) return <text fg={muted}>Loading…</text>

      const lines: string[] = []
      lines.push(`workspace  ${data.workspace.name ?? data.workspace.id}`)
      lines.push(`plan       ${plan()}`)
      lines.push("")

      if (data.go) {
        lines.push("Go allowance")
        lines.push(
          `  used     ${Math.round(data.go.monthly.percent)}%  ${
            data.go.monthly.limited ? "limit reached" : bar(data.go.monthly.percent)
          }`,
        )
        lines.push(`  resets   in ${formatSpan(data.go.monthly.resetsAt - Date.now())}`)
        lines.push(
          `  weekly   ${Math.round(data.go.weekly.percent)}% · resets in ${formatSpan(
            data.go.weekly.resetsAt - Date.now(),
          )}`,
        )
        lines.push(
          `  rolling  ${Math.round(data.go.rolling.percent)}% · resets in ${formatSpan(
            data.go.rolling.resetsAt - Date.now(),
          )}`,
        )
      }

      const list = budgets()
      if (list.length > 0) {
        if (data.go) lines.push("")
        lines.push("Console budgets")
        list.forEach((item, index) => {
          if (index > 0) lines.push("")
          const percent = budgetPercent(item)
          const title = `${budgetLabel(item)}${item.picked ? " · picked" : ""}${
            item.shared ? " · shared" : ""
          }`
          lines.push(`  ${list.length > 1 ? `${index + 1}. ` : ""}${title}`)
          lines.push(
            `  used     ${
              percent === null
                ? "no limit"
                : percent >= 100
                  ? "limit reached"
                  : `${Math.round(percent)}%  ${bar(percent)}`
            }`,
          )
          lines.push(
            `  spend    $${formatMoney(budgetBasis(item))} / $${formatMoney(item.limit)}`,
          )
          const left = item.limit - budgetBasis(item)
          if (left > 0) lines.push(`  left     $${formatMoney(left)}`)
          lines.push(`  resets   in ${formatSpan(item.resetsAt - Date.now())}`)
          if (item.scope === "each") lines.push("  scope    per model")
          if (item.scope === "combined") lines.push("  scope    combined")
          if (item.inputPriceAtLeast && item.inputPriceAtLeast > 0) {
            lines.push(`  prices   input from $${formatMoney(item.inputPriceAtLeast)} / 1M`)
          }

          const models = item.models
            .filter((model) => (model.spent ?? 0) > 0)
            .slice()
            .sort((a, b) => (b.spent ?? 0) - (a.spent ?? 0))
            .slice(0, 3)
          if (models.length > 0) {
            const parts = models.map((model) =>
              item.scope === "each"
                ? `${model.name} $${formatMoney(model.spent ?? 0)}/$${formatMoney(item.limit)}`
                : `${model.name} $${formatMoney(model.spent ?? 0)}`,
            )
            lines.push(`  models   ${parts.join(" · ")}`)
          }
        })
      } else if (!data.go) {
        lines.push("monthly limit")
        lines.push("  none     no Go allowance or Console budget applies")
      }

      const value = stats()
      if (value) {
        lines.push("")
        lines.push("today")
        lines.push(
          `  spend    $${formatMoney(value.cost)} · ${value.steps} steps · ${value.sessions} sessions`,
        )
        lines.push(
          `  tokens   ${formatTokens(value.tokens.input)} in · ${formatTokens(
            value.tokens.output,
          )} out`,
        )
        for (const item of value.models.slice().sort((a, b) => b.cost - a.cost).slice(0, 5)) {
          lines.push(`  ${shortModel(item.model.id).padEnd(9)} $${formatMoney(item.cost)}`)
        }
      }

      lines.push("")
      lines.push("forecast")
      const pace = forecast(cyclePoints())
      if (pace && pace.ratePerHour > 0) {
        lines.push(
          `  rate     ${pace.ratePerHour.toFixed(2)}%/h over ${Math.round(
            pace.spanHours,
          )}h (${pace.points} points)`,
        )
        if (pace.etaDays !== null) {
          lines.push(`  limit    in ~${Math.round(pace.etaDays)} days at this rate`)
        }
      } else if (pace) {
        lines.push("  rate     no change in the observation window")
      } else {
        lines.push("  rate     not enough history yet")
      }
      const projected = projection()
      if (data.go?.monthly.limited) {
        lines.push("  on pace  monthly limit reached")
      } else if (budgetReached()) {
        lines.push("  on pace  budget limit reached")
      } else if (projected) {
        if (projected.kind === "limit") {
          lines.push(
            `  on pace  ${Math.round(projected.projected)}% of the monthly limit by reset`,
          )
        } else {
          lines.push(`  on pace  $${formatMoney(projected.projected)} per month`)
        }
      } else if (data.go) {
        lines.push("  on pace  not enough usage to forecast yet")
      } else {
        lines.push("  on pace  n/a (no month data yet)")
      }
      const monthValue = month()
      if (monthValue) lines.push(`  month    $${formatMoney(monthValue.cost)} so far`)

      lines.push("")
      // The data above is kept from the last successful read; say that it is old
      // and why, instead of pretending the failure did not happen.
      if (error()) {
        lines.push(`refresh failed: ${error()}`)
      }
      const stale = staleAge()
      if (stale !== null) lines.push(`stale ${formatSpan(stale)} — numbers are from the last good read`)
      const updated = updatedAt()
      lines.push(
        `${updated ? new Date(updated).toLocaleTimeString() : "—"} · ${data.workspace.usageURL}`,
      )
      lines.push("/limits refresh — update · esc / q — back")

      return <text fg={muted}>{lines.join("\n")}</text>
    }

    const unregisterRoute = context.ui.router.register({
      name: "usage",
      render: () => (
        <box flexDirection="column">
          {detail()}
        </box>
      ),
    })

    const unregisterSlot =
      options.slot === "footer"
        ? context.ui.slot({ append: "sidebar.footer", render: summary })
        : context.ui.slot({ append: "sidebar.content", render: summary })

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "usage.lens.show",
          title: "Limits: allowance, spend and forecast",
          description: "OpenCode Go allowance and Console budgets",
          group: "Usage",
          palette: true,
          slash: { name: "limits", aliases: ["spend"], arguments: true },
          run: (input) => {
            if ((input ?? "").trim().toLowerCase() === "refresh") return refresh()
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
          id: "usage.lens.back",
          title: "Limits: back",
          bind: "escape",
          run: goBack,
        },
        {
          id: "usage.lens.back.q",
          title: "Limits: back (q)",
          bind: "q",
          run: goBack,
        },
      ],
    }))

    const stop = context.data.on("session.execution.succeeded", () => {
      void refresh()
    })
    // `opencode auth login` happens outside the panel; reload instead of
    // waiting for the next poll so the allowance appears right away.
    const stopCredential = context.data.on("credential.updated", () => {
      void refresh()
    })
    const timer = setInterval(() => void refresh(), 60_000)
    void refresh()

    return () => {
      clearInterval(timer)
      stop()
      stopCredential()
      unregisterSlot()
      unregisterRoute()
    }
  },
})

function shortModel(id: string): string {
  const clean = id.replace(/^.*\//, "")
  return clean.length > 12 ? `${clean.slice(0, 11)}…` : clean
}
