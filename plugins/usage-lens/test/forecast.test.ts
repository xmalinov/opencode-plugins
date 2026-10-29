/// <reference types="node" />
import assert from "node:assert/strict"
import { test } from "node:test"
import { usageText, type UsagePoint } from "../src/forecast.ts"

const HOUR = 3_600_000
const MINUTE = 60_000
const now = Date.UTC(2026, 9, 27, 12, 0)

const point = (t: number, monthly: number): UsagePoint => ({ t, monthly, weekly: 0, rolling: 0 })

test("with no readings it says where they come from", () => {
  assert.equal(
    usageText([], now),
    "No readings yet: open /limits in the TUI once so the panel records one.",
  )
})

test("a single reading gives the percentages, not a made-up rate", () => {
  const text = usageText([point(now - 30_000, 73)], now)

  assert.match(text, /^monthly 73% · weekly 0% · rolling 5h 0%$/m)
  assert.match(text, /^last reading just now$/m)
  assert.match(text, /^rate: not enough history yet$/m)
})

test("a rising series gives the rate and the time to the limit", () => {
  const text = usageText(
    [point(now - 14.5 * HOUR, 10), point(now - 8.5 * HOUR, 20), point(now - 2.5 * HOUR, 30)],
    now,
  )

  assert.match(text, /^last reading 2h 30m ago, recorded while the panel was open$/m)
  assert.match(text, /^rate: 1\.67%\/h over 12h \(3 points\)$/m)
  assert.match(text, /^limit: in ~2 days at this rate$/m)
})

test("a flat series is reported as no change", () => {
  const text = usageText(
    [point(now - 12 * HOUR, 40), point(now - 6 * HOUR, 40), point(now - MINUTE, 40)],
    now,
  )

  assert.match(text, /^rate: no change over 12h \(3 points\)$/m)
  assert.doesNotMatch(text, /^limit:/m)
})
