/// <reference types="node" />
import assert from "node:assert/strict"
import { test } from "node:test"
import { describeFailure } from "../src/failure.ts"

const of = (message: string) => describeFailure(new Error(message))

test("a rate limit says so and keeps its status", () => {
  assert.equal(of("HTTP 429 Too Many Requests"), "rate limited (429)")
  assert.equal(of("Rate limit exceeded"), "rate limited")
})

test("an expired login asks for a sign-in again", () => {
  assert.equal(of("HTTP 401"), "sign in again (401)")
  assert.equal(of("Unauthorized"), "sign in again")
  assert.equal(of("invalid api key"), "sign in again")
})

test("a timeout is told apart from a network failure", () => {
  assert.equal(of("The operation was aborted due to timeout"), "timed out")
  assert.equal(of("timed out after 15000ms"), "timed out")
  assert.equal(of("fetch failed"), "network error")
  assert.equal(of("getaddrinfo ENOTFOUND timor.tech"), "network error")
  assert.equal(of("socket hang up"), "network error")
})

test("a status code alone picks the phrase", () => {
  assert.equal(of("HTTP 503"), "server error (503)")
  assert.equal(of("HTTP 404"), "not found (404)")
})

test("a missing plugin server part is named", () => {
  assert.equal(of("rpc.unavailable"), "plugin server part is not loaded")
})

test("an unknown reason is passed through on one line", () => {
  assert.equal(of("unrecognized calendar payload"), "unrecognized calendar payload")
  assert.equal(of("line one\nline two"), "line one line two")
  assert.equal(describeFailure("plain string"), "plain string")
  assert.equal(describeFailure(undefined), "unknown error")
})

test("a long reason is cut, so a body cannot flood the toast", () => {
  const long = of("x".repeat(500))
  assert.equal(long.length, 160)
})
