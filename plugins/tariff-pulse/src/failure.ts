/**
 * One line for the user when a request fails: what happened, not the raw error.
 * Pure, no SDK imports.
 *
 * The two plugins publish separately, so this module is duplicated rather than
 * imported across package boundaries. Keep the copies identical.
 */

/** Longer than any useful reason; an API body is cut here. */
const MAX_LENGTH = 160

/** Checked in order; the first match wins. */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b429\b|rate.?limit|too many requests/i, "rate limited"],
  [
    /\b(?:401|403)\b|unauthori[sz]ed|invalid api key|auth(?:entication)? error|sign in/i,
    "sign in again",
  ],
  [/\btimed? ?out\b|\btimeout\b|\baborted due to\b/i, "timed out"],
  [
    /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN)\b|fetch failed|socket hang up|network/i,
    "network error",
  ],
  [/rpc\.unavailable/i, "plugin server part is not loaded"],
  [/\b5\d{2}\b/, "server error"],
  [/\b404\b/, "not found"],
]

/** The message of anything thrown, collapsed to one line and cut. */
function text(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message || error.name
      : typeof error === "string"
        ? error
        : ""
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH)
}

/**
 * A short, actionable phrase: "rate limited (429)", "sign in again (401)",
 * "timed out". Anything unrecognized comes back as its own one-line message.
 * Nothing here leaves the machine, so there is no secret redaction.
 */
export function describeFailure(error: unknown): string {
  const message = text(error)
  if (!message) return "unknown error"

  const status = /\b([1-5]\d{2})\b/.exec(message)?.[1]
  const rule = RULES.find(([pattern]) => pattern.test(message))
  if (!rule) return message
  return status ? `${rule[1]} (${status})` : rule[1]
}
