/**
 * Console budget math: pure logic, no SDK imports.
 *
 * Without a Go subscription the workspace's budgets are the limits: `limit`
 * and `spent` are USD, `resetsAt` is the end of the budget period.
 */

export interface BudgetModel {
  readonly providerID?: string
  readonly modelID?: string
  readonly name: string
  readonly spent?: number
}

export interface Budget {
  readonly limit: number
  readonly spent: number
  readonly resetsAt: number
  readonly picked: boolean
  readonly shared?: boolean
  /** "each" — the limit applies to every model separately, "combined" — one pool. */
  readonly scope?: "each" | "combined"
  readonly per?: "set" | "model"
  readonly coverage?: "all" | "models"
  readonly vendors?: readonly string[]
  readonly inputPriceAtLeast?: number
  readonly models: readonly BudgetModel[]
}

export interface BudgetModelRef {
  readonly providerID: string
  readonly modelID: string
}

/**
 * The budget that represents the current limit: the one picked in the
 * Console, then one that covers the selected model, then the first one.
 */
export function pickBudget(
  list: readonly Budget[],
  model: BudgetModelRef | null,
): Budget | undefined {
  if (list.length === 0) return undefined

  const picked = list.find((item) => item.picked)
  if (picked) return picked

  if (model) {
    const match = list.find(
      (item) =>
        item.coverage !== "all" &&
        item.models.some(
          (entry) => entry.providerID === model.providerID && entry.modelID === model.modelID,
        ),
    )
    if (match) return match
  }

  return list[0]
}

/** A per-model budget is judged by its most consumed model, not by the total. */
export function budgetBasis(item: Budget): number {
  if (item.scope !== "each" || item.models.length === 0) return item.spent
  const top = Math.max(...item.models.map((model) => model.spent ?? 0))
  return top > 0 ? top : item.spent
}

export function budgetPercent(item: Budget): number | null {
  if (!(item.limit > 0)) return null
  return (budgetBasis(item) / item.limit) * 100
}

export function budgetLabel(item: Budget): string {
  if (item.coverage === "all") return "all models"
  const names = item.models.map((model) => model.name).filter((name) => name.length > 0)
  if (names.length === 0) {
    return item.vendors && item.vendors.length > 0
      ? item.vendors.join(", ")
      : "selected models"
  }
  if (names.length <= 2) return names.join(", ")
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`
}
