# usage-lens

Spend and allowance panel for OpenCode V2: remaining monthly limit, pace, forecast and reset date — like the dashboard, but inside the TUI.

```
usage
73% ███████░ · $58/$80
reset 9d · 5h 41% · wk 62%
today $3.42 · 14 steps · 150k
Flash 61% · Pro 32%
limit ~6d at this pace
```

## Where the data comes from

- `GET /api/experimental/usage/limits` — Go allowance (rolling 5-hour / weekly / monthly windows, percentages and `resetsAt`) and Console budgets.
- `GET /api/experimental/session/stats` — today's spend, tokens, steps and per-model split.
- Percentage snapshots power the measured pace; they are stored locally.

Nothing is sent anywhere.

If `tariff-pulse` is installed, a tariff line is added at the top of the panel (`▲ PEAK ×2 · 1h 42m`). The link is optional: without it the line is hidden and the panel behaves normally.

## Commands

- `/limits` — detailed panel: monthly limit, budgets, today, models, forecast.
- `/limits refresh` — refresh now.
- `esc` or `q` — leave the page.

`/usage` is a **built-in** OpenCode command with its own page. This plugin uses `/limits` (alias `/spend`) to avoid intercepting it.

## Installation

```jsonc title="opencode.jsonc"
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./plugins/usage-lens",
      "options": { "compact": false, "plan": "Go" }
    }
  ]
}
```

| Option | Default | Meaning |
|---|---|---|
| `compact` | `false` | one line instead of a block |
| `plan` | `Go` when limits exist | plan label; the API does not say whether it is Go or Go Plus |
| `slot` | `content` | `content` (main area, above) or `footer` (bottom of the sidebar) |

## Forecast

`on pace` mirrors the Console dashboard: the monthly percentage is stretched linearly from the start of the period to `resetsAt`.

```
projected = percent × (resetsAt − start) / (now − start)
```

The line appears once the period is at least a day old and spend is non-zero; at the limit it is replaced by `monthly limit reached`. The API returns an integer percentage, so early in the period the value can differ from the dashboard by 1–2 pp.

The `/limits` panel also computes a **measured** pace from snapshots — recent speed rather than the period average:

```
rate = (p_last − p_first) / hours     # window up to 7 days
eta  = (100 − p_last) / rate / 24     # days at this pace
```

Shown only with ≥3 points and ≥6 hours of observation. With zero spend there is no measured pace.

Without a Go plan, `on pace $42/mo` is derived from local spend this month.

Snapshots are written at most every 5 minutes and capped at 2880 points (~10 days).

## RPC

| Method | Purpose |
|---|---|
| `ingest({ point })` | add a snapshot, return the forecast |
| `history()` | point count and forecast |
| `reset()` | clear history |

```sh
opencode api post '/api/rpc/usage_lens/history?location[directory]=.' --data '{"input":{}}'
```

## Limitations

- **The API has no next billing date for the subscription.** The panel shows "limit resets in N days" from `resetsAt`; that is not the payment date.
- Console credit balance is not exposed — only `spent`/`limit` per budget.
- `experimental.*` may change. Every call is isolated: on error the panel shows `usage unavailable` instead of breaking.
- If the Console session is not signed in, `data` is `null` → `not connected`.
- Limit percentages and dollars are different quantities; the panel labels them separately.

## Development

```sh
npm install --no-save typescript @opencode/plugin@2.2.0 solid-js @opentui/core@0.6.6 @opentui/solid@0.6.6
./node_modules/.bin/tsc -p tsconfig.json
```

`src/forecast.ts` has no SDK imports and can be run with a plain Node script.
