/// <reference types="node" />
import assert from "node:assert/strict"
import { test } from "node:test"
import type { Budget } from "../src/budget.ts"
import { budgetReached, limitsPage, projection, type Limits, type LimitsViewInput } from "../src/view.ts"

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** The middle of a Go cycle that ends on 2026-11-01: 50% used is exactly on pace for 100%. */
const resetsAt = Date.UTC(2026, 10, 1)
const now = Date.UTC(2026, 9, 16, 12)

const go = {
  rolling: { percent: 41, limited: false, resetsAt: now + 2 * HOUR },
  weekly: { percent: 62, limited: false, resetsAt: now + 3 * DAY },
  monthly: { percent: 50, limited: false, resetsAt },
}

const goLimits: Limits = {
  workspace: { id: "ws_1", name: "Work", usageURL: "https://opencode.ai/usage" },
  go,
  budgets: [],
}

const budget = (over: Partial<Budget> = {}): Budget => ({
  limit: 50,
  spent: 21,
  resetsAt: now + 9 * DAY,
  picked: true,
  scope: "each",
  models: [{ providerID: "opencode-go", modelID: "deepseek-v4.1-flash", name: "deepseek", spent: 21 }],
  ...over,
})

const consoleLimits = (budgets: readonly Budget[]): Limits => ({
  workspace: { id: "ws_1", usageURL: "https://opencode.ai/usage" },
  budgets,
})

const input = (over: Partial<LimitsViewInput> = {}): LimitsViewInput => ({
  limits: goLimits,
  stats: null,
  month: null,
  points: [],
  model: null,
  signedOut: false,
  error: null,
  updatedAt: now,
  now,
  ...over,
})

test("a failure before the first read says what failed", () => {
  const page = limitsPage(input({ limits: null, error: "network error" }))

  assert.equal(page.tone, "warning")
  assert.deepEqual(page.lines, [
    "Usage API is unavailable",
    "network error",
    "/limits refresh — retry · esc — back",
  ])
})

test("a signed-out or loading page stays calm", () => {
  assert.equal(limitsPage(input({ signedOut: true })).lines[0], "Usage · not connected")
  assert.deepEqual(limitsPage(input({ limits: null })).lines, ["Loading…"])
})

test("the Go page shows every window, the next reset and the on-pace forecast", () => {
  const page = limitsPage(input())

  assert.equal(page.tone, "muted")
  assert.ok(page.lines.includes("workspace  Work"))
  assert.ok(page.lines.includes("plan       Go"))
  assert.ok(page.lines.includes("Go allowance"))
  assert.ok(page.lines.includes("  used     50%  ████░░░░"))
  assert.ok(page.lines.includes("  resets   in 15d 12h"))
  assert.ok(page.lines.includes("  weekly   62% · resets in 3d"))
  assert.ok(page.lines.includes("  rolling  41% · resets in 2h 1m"))
  assert.ok(page.lines.includes("  rate     not enough history yet"))
  assert.ok(page.lines.includes("  on pace  100% of the monthly limit by reset"))
  assert.ok(page.lines.some((line) => line.endsWith("· https://opencode.ai/usage")))
})

test("a used-up monthly window replaces the meter and the forecast", () => {
  const limited: Limits = {
    ...goLimits,
    go: { ...go, monthly: { ...go.monthly, percent: 100, limited: true } },
  }
  const page = limitsPage(input({ limits: limited }))

  assert.ok(page.lines.includes("  used     100%  limit reached"))
  assert.ok(page.lines.includes("  on pace  monthly limit reached"))
})

test("a Console budget is judged by its own scope and shown with its prices", () => {
  const page = limitsPage(
    input({
      limits: consoleLimits([
        budget({ inputPriceAtLeast: 0.3 }),
        budget({ picked: false, scope: "combined", spent: 30, limit: 100 }),
      ]),
    }),
  )

  assert.ok(page.lines.includes("plan       Console"))
  assert.ok(page.lines.includes("Console budgets"))
  assert.ok(page.lines.includes("  1. deepseek · picked"))
  assert.ok(page.lines.includes("  used     42%  ███░░░░░"))
  assert.ok(page.lines.includes("  spend    $21.00 / $50.00"))
  assert.ok(page.lines.includes("  left     $29.00"))
  assert.ok(page.lines.includes("  scope    per model"))
  assert.ok(page.lines.includes("  prices   input from $0.30 / 1M"))
  assert.ok(page.lines.includes("  models   deepseek $21.00/$50.00"))
  assert.ok(page.lines.includes("  2. deepseek"))
  assert.ok(page.lines.includes("  used     30%  ██░░░░░░"))
  assert.ok(page.lines.includes("  scope    combined"))
})

test("a budget without a limit reports spend, not a percentage", () => {
  const page = limitsPage(input({ limits: consoleLimits([budget({ limit: 0 })]) }))

  assert.ok(page.lines.includes("  used     no limit"))
  assert.ok(page.lines.includes("  spend    $21.00 / $0.00"))
  assert.ok(!page.lines.some((line) => line.startsWith("  left")))
})

test("a budget at its limit is named, not measured", () => {
  const spent = budget({
    spent: 50,
    models: [
      { providerID: "opencode-go", modelID: "deepseek-v4.1-flash", name: "deepseek", spent: 50 },
    ],
  })
  const page = limitsPage(input({ limits: consoleLimits([spent]) }))

  assert.ok(page.lines.includes("  used     limit reached"))
  assert.ok(page.lines.includes("  on pace  budget limit reached"))
  assert.equal(budgetReached(consoleLimits([spent]), null), true)
  assert.equal(budgetReached(goLimits, null), false)
})

test("without Go and without budgets the page says so", () => {
  const page = limitsPage(input({ limits: consoleLimits([]) }))

  assert.ok(page.lines.includes("monthly limit"))
  assert.ok(page.lines.includes("  none     no Go allowance or Console budget applies"))
})

test("a failed refresh keeps the numbers and marks them stale", () => {
  const page = limitsPage(
    input({ error: "network error", updatedAt: now - 20 * 60_000 }),
  )

  assert.equal(page.tone, "muted")
  assert.ok(page.lines.includes("refresh failed: network error"))
  assert.ok(
    page.lines.includes("stale 20m — numbers are from the last good read"),
    page.lines.join("\n"),
  )
})

test("today's spend and models sit between the limits and the forecast", () => {
  const page = limitsPage(
    input({
      stats: {
        cost: 3.42,
        steps: 14,
        sessions: 2,
        tokens: { input: 150_000, output: 20_000 },
        models: [{ model: { id: "deepseek-v4.1-flash", providerID: "opencode-go" }, cost: 3.42, steps: 14 }],
      },
    }),
  )

  assert.ok(page.lines.includes("today"))
  assert.ok(page.lines.includes("  spend    $3.42 · 14 steps · 2 sessions"))
  assert.ok(page.lines.includes("  tokens   150k in · 20k out"))
  assert.ok(page.lines.includes("  deepseek-v4… $3.42"))
})

test("projection follows the Console for Go and the month's spend otherwise", () => {
  const paced = projection(goLimits, null, now)
  assert.equal(paced?.kind, "limit")
  assert.equal(Math.round(paced!.projected), 100)

  // A mid-month reading of $20 in a 31-day month projects to about $40.
  const midMonth = new Date(2026, 9, 16, 12).getTime()
  const spend = projection(consoleLimits([]), { ...statsOf(20), cost: 20 }, midMonth)
  assert.equal(spend?.kind, "spend")
  assert.ok(Math.abs(spend!.projected - 40) < 1, String(spend!.projected))

  assert.equal(projection(consoleLimits([]), null, now), null)
})

function statsOf(cost: number) {
  return { cost, steps: 0, sessions: 0, tokens: { input: 0, output: 0 }, models: [] }
}
