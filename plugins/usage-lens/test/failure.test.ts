/// <reference types="node" />
import assert from "node:assert/strict"
import { test } from "node:test"
import { describeFailure } from "../src/failure.ts"

// The module is a copy of the one in tariff-pulse; this guards the copy from drifting.
test("the shared rules survive the copy", () => {
  assert.equal(describeFailure(new Error("HTTP 429")), "rate limited (429)")
  assert.equal(describeFailure(new Error("Unauthorized")), "sign in again")
  assert.equal(describeFailure(new Error("fetch failed")), "network error")
  assert.equal(describeFailure(new Error("something else")), "something else")
})
