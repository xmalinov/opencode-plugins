import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import {
  bar,
  formatMoney,
  formatSpan,
  formatTokens,
  meterColor,
  pushPoint,
  type UsagePoint,
} from "./forecast.js"
import { budgetBasis, budgetLabel, budgetPercent, pickBudget, type Budget } from "./budget.js"
import { describeFailure } from "./failure.js"
import { UsageRpc } from "./rpc.js"
import {
  STALE_MS,
  budgetReached,
  limitsPage,
  monthStart,
  planName,
  projection,
  type Limits,
  type Stats,
} from "./view.js"

/** A stalled call must not leave the panel on old numbers for ever. */
const RPC_TIMEOUT_MS = 15_000

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
              from: monthStart(now),
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
          setError(describeFailure(limitResult.reason))
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

    const outlook = () => projection(limits(), month(), Date.now())
    const isBudgetReached = () => budgetReached(limits(), context.ui.model.current() ?? null)

    const paceLine = () => {
      if (limits()?.go?.monthly.limited) return "monthly limit reached"
      if (isBudgetReached()) return "budget reached"
      const value = outlook()
      if (!value) return ""
      if (value.kind === "limit") {
        return `on pace ${Math.round(value.projected)}% by reset`
      }
      return `on pace $${formatMoney(value.projected)}/mo`
    }

    const paceColor = () => {
      if (limits()?.go?.monthly.limited || isBudgetReached()) return feedback.error
      const value = outlook()
      if (!value) return muted
      if (value.kind === "limit" && value.projected > 100) return feedback.warning
      return base
    }

    const planLine = () => {
      const name = planName(limits(), planLabel)
      const item = limits()?.go ? undefined : primaryBudget()
      return item ? `${name} · ${budgetLabel(item)}` : name
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
      const page = limitsPage({
        limits: limits(),
        stats: stats(),
        month: month(),
        points: points.items,
        model: context.ui.model.current() ?? null,
        planLabel,
        signedOut: signedOut(),
        error: error(),
        updatedAt: updatedAt(),
        now: Date.now(),
      })
      return (
        <text fg={page.tone === "warning" ? feedback.warning : muted}>
          {page.lines.join("\n")}
        </text>
      )
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
