/**
 * The `/limits` page as text: workspace, plan, Go allowance, Console budgets, today's
 * spend and the forecast. Pure, no SDK imports, so the money and percent branches are
 * covered by tests.
 *
 * The imports carry `.ts`: Node's type stripping does not remap `.js`, and the tests
 * load this module directly.
 */
import { budgetBasis, budgetLabel, budgetPercent, pickBudget, type Budget } from "./budget.ts"
import {
  DAY,
  bar,
  cycleStart,
  forecast,
  formatMoney,
  formatSpan,
  formatTokens,
  projectLimit,
  type UsagePoint,
} from "./forecast.ts"

export interface Meter {
  readonly percent: number
  readonly limited: boolean
  readonly resetsAt: number
}

export interface Limits {
  readonly workspace: { readonly id: string; readonly name?: string; readonly usageURL: string }
  readonly go?: { readonly rolling: Meter; readonly weekly: Meter; readonly monthly: Meter }
  readonly budgets: readonly Budget[]
}

export interface ModelUsage {
  readonly model: { readonly id: string; readonly providerID: string }
  readonly cost: number
  readonly steps: number
}

export interface Stats {
  readonly cost: number
  readonly steps: number
  readonly sessions: number
  readonly tokens: { readonly input: number; readonly output: number }
  readonly models: readonly ModelUsage[]
}

export interface Projection {
  readonly kind: "limit" | "spend"
  readonly projected: number
}

export type ModelRef = { readonly providerID: string; readonly modelID: string }

/** A reading older than a few polls is not fresh, and the panel says so. */
export const STALE_MS = 5 * 60_000

export interface LimitsViewInput {
  readonly limits: Limits | null
  readonly stats: Stats | null
  readonly month: Stats | null
  readonly points: readonly UsagePoint[]
  readonly model: ModelRef | null
  readonly planLabel?: string
  readonly signedOut: boolean
  readonly error: string | null
  readonly updatedAt: number | null
  readonly now: number
}

export interface LimitsView {
  readonly lines: readonly string[]
  /** `warning` for a page reporting a failure, `muted` for data. */
  readonly tone: "muted" | "warning"
}

/** Start of the local month holding `now`. */
export function monthStart(now: number): number {
  const date = new Date(now)
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}

/** The Console's own formula: the month's spend stretched to the whole month. */
export function projection(
  limits: Limits | null,
  month: Stats | null,
  now: number,
  points: readonly UsagePoint[] = [],
): Projection | null {
  const go = limits?.go
  if (go) {
    const measured = forecast(cyclePoints(limits, points))
    const projected = projectLimit({
      percent: go.monthly.percent,
      resetsAt: go.monthly.resetsAt,
      now,
      ratePerHour: measured?.ratePerHour ?? null,
    })
    return projected === null ? null : { kind: "limit", projected }
  }
  if (!month) return null

  const date = new Date(now)
  const elapsed = Math.max(0.5, (now - monthStart(now)) / DAY)
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return { kind: "spend", projected: (month.cost / elapsed) * days }
}

export function planName(limits: Limits | null, label?: string): string {
  if (label) return label
  if (limits?.go) return "Go"
  return (limits?.budgets.length ?? 0) > 0 ? "Console" : "no plan limits"
}

export function budgetReached(limits: Limits | null, model: ModelRef | null): boolean {
  if (limits?.go) return false
  const item = pickBudget(limits?.budgets ?? [], model)
  return item !== undefined && (budgetPercent(item) ?? 0) >= 100
}

/** Readings from the current Go cycle only: older ones would make the rate negative. */
function cyclePoints(limits: Limits | null, points: readonly UsagePoint[]): readonly UsagePoint[] {
  const go = limits?.go
  if (!go) return points
  const start = cycleStart(go.monthly.resetsAt)
  return points.filter((point) => point.t >= start)
}

function shortModel(id: string): string {
  const clean = id.replace(/^.*\//, "")
  return clean.length > 12 ? `${clean.slice(0, 11)}…` : clean
}

export function limitsPage(input: LimitsViewInput): LimitsView {
  const { limits, stats, month, points, model, planLabel, signedOut, error, updatedAt, now } = input

  if (error && !limits) {
    return {
      tone: "warning",
      lines: ["Usage API is unavailable", error, "/limits refresh — retry · esc — back"],
    }
  }
  if (signedOut) {
    return {
      tone: "muted",
      lines: [
        "Usage · not connected",
        "Sign in to the OpenCode Console to see allowance and budgets.",
        "esc — back",
      ],
    }
  }
  if (!limits) return { tone: "muted", lines: ["Loading…"] }

  const data = limits
  const lines: string[] = []
  lines.push(`workspace  ${data.workspace.name ?? data.workspace.id}`)
  lines.push(`plan       ${planName(data, planLabel)}`)
  lines.push("")

  if (data.go) {
    lines.push("Go allowance")
    lines.push(
      `  used     ${Math.round(data.go.monthly.percent)}%  ${
        data.go.monthly.limited ? "limit reached" : bar(data.go.monthly.percent)
      }`,
    )
    lines.push(`  resets   in ${formatSpan(data.go.monthly.resetsAt - now)}`)
    lines.push(
      `  weekly   ${Math.round(data.go.weekly.percent)}% · resets in ${formatSpan(
        data.go.weekly.resetsAt - now,
      )}`,
    )
    lines.push(
      `  rolling  ${Math.round(data.go.rolling.percent)}% · resets in ${formatSpan(
        data.go.rolling.resetsAt - now,
      )}`,
    )
  }

  const list = data.budgets
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
      lines.push(`  spend    $${formatMoney(budgetBasis(item))} / $${formatMoney(item.limit)}`)
      const left = item.limit - budgetBasis(item)
      if (left > 0) lines.push(`  left     $${formatMoney(left)}`)
      lines.push(`  resets   in ${formatSpan(item.resetsAt - now)}`)
      if (item.scope === "each") lines.push("  scope    per model")
      if (item.scope === "combined") lines.push("  scope    combined")
      if (item.inputPriceAtLeast && item.inputPriceAtLeast > 0) {
        lines.push(`  prices   input from $${formatMoney(item.inputPriceAtLeast)} / 1M`)
      }

      const models = item.models
        .filter((entry) => (entry.spent ?? 0) > 0)
        .slice()
        .sort((a, b) => (b.spent ?? 0) - (a.spent ?? 0))
        .slice(0, 3)
      if (models.length > 0) {
        const parts = models.map((entry) =>
          item.scope === "each"
            ? `${entry.name} $${formatMoney(entry.spent ?? 0)}/$${formatMoney(item.limit)}`
            : `${entry.name} $${formatMoney(entry.spent ?? 0)}`,
        )
        lines.push(`  models   ${parts.join(" · ")}`)
      }
    })
  } else if (!data.go) {
    lines.push("monthly limit")
    lines.push("  none     no Go allowance or Console budget applies")
  }

  if (stats) {
    lines.push("")
    lines.push("today")
    lines.push(
      `  spend    $${formatMoney(stats.cost)} · ${stats.steps} steps · ${stats.sessions} sessions`,
    )
    lines.push(
      `  tokens   ${formatTokens(stats.tokens.input)} in · ${formatTokens(
        stats.tokens.output,
      )} out`,
    )
    for (const item of stats.models.slice().sort((a, b) => b.cost - a.cost).slice(0, 5)) {
      lines.push(`  ${shortModel(item.model.id).padEnd(9)} $${formatMoney(item.cost)}`)
    }
  }

  lines.push("")
  lines.push("forecast")
  const pace = forecast(cyclePoints(data, points))
  if (pace && pace.ratePerHour > 0) {
    lines.push(
      `  rate     ${pace.ratePerHour.toFixed(2)}%/h over ${Math.round(pace.spanHours)}h (${
        pace.points
      } points)`,
    )
    if (pace.etaDays !== null) {
      lines.push(`  limit    in ~${Math.round(pace.etaDays)} days at this rate`)
    }
  } else if (pace) {
    lines.push("  rate     no change in the observation window")
  } else {
    lines.push("  rate     not enough history yet")
  }

  const projected = projection(data, month, now, points)
  if (data.go?.monthly.limited) {
    lines.push("  on pace  monthly limit reached")
  } else if (budgetReached(data, model)) {
    lines.push("  on pace  budget limit reached")
  } else if (projected) {
    if (projected.kind === "limit") {
      lines.push(`  on pace  ${Math.round(projected.projected)}% of the monthly limit by reset`)
    } else {
      lines.push(`  on pace  $${formatMoney(projected.projected)} per month`)
    }
  } else if (data.go) {
    lines.push("  on pace  not enough usage to forecast yet")
  } else {
    lines.push("  on pace  n/a (no month data yet)")
  }

  if (month) lines.push(`  month    $${formatMoney(month.cost)} so far`)

  lines.push("")
  // The data above is kept from the last successful read; say that it is old
  // and why, instead of pretending the failure did not happen.
  if (error) lines.push(`refresh failed: ${error}`)
  if (updatedAt !== null && now - updatedAt > STALE_MS) {
    lines.push(`stale ${formatSpan(now - updatedAt)} — numbers are from the last good read`)
  }
  lines.push(
    `${updatedAt === null ? "—" : new Date(updatedAt).toLocaleTimeString()} · ${
      data.workspace.usageURL
    }`,
  )
  lines.push("/limits refresh — update · esc / q — back")

  return { tone: "muted", lines }
}
