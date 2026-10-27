# tariff-pulse

DeepSeek peak/off-peak tariff indicator for OpenCode V2.

It shows what a request will cost **right now** and how long until the window changes. One question: send it, or wait?

```
▲ PEAK ×2 · 1h 42m        expensive now, off-peak in 1h 42m
▼ OFF −50% · 3h 05m       off-peak now
▲? PEAK ×2 · 2h 10m       holiday calendar is stale — price uncertain
```

## The tariff in short

| | |
|---|---|
| Peak | `01:00–04:00` and `06:00–10:00` UTC, Mon–Fri |
| PRC holidays | off-peak all day |
| Off-peak | exactly ½ of the peak price |
| Prices | USD per 1M tokens, as of 2026-10-27 |

Source: <https://api-docs.deepseek.com/quick_start/pricing>.

The tariff applies only to providers on the list (`deepseek`, `opencode-go`). For `cloudflare-workers-ai` no badge is shown: same DeepSeek models, but no time-based discounts.

OpenCode's model catalogue advertises the **off-peak** price, which is why the badge matters: during peak, the real cost is twice what the model picker shows.

## Commands

- `/tier` — schedule, prices, calendar state.
- `/tier refresh` — fetch a fresh holiday calendar.
- `/tier test peak` / `/tier test off` / `/tier test live` — freeze the clock to check colors (`TEST` appears in the badge).
- `esc` or `q` — leave the `/tier` page.

## Installation

```jsonc title="opencode.jsonc"
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./plugins/tariff-pulse",
      "options": {
        "nearChangeMinutes": 15
      }
    }
  ]
}
```

## Options

| Option | Default | Meaning |
|---|---|---|
| `providers` | `["deepseek", "opencode-go"]` | providers the tariff applies to |
| `nearChangeMinutes` | `15` | badge turns amber this many minutes before a window change |
| `holidays` | bundled 2026 calendar | `{ dates: string[], validUntil: string, source?: string }` |
| `holidayURL` | `https://timor.tech/api/holiday/year/<year>` | source used by `/tier refresh` |

## RPC

| Method | Purpose |
|---|---|
| `status({ providerID, modelID, at? })` | current tier, prices, next change |
| `schedule()` | windows, calendar, price source |
| `setHolidays({ dates, validUntil, source? })` | store a refreshed calendar |

```sh
opencode api post '/api/rpc/tariff_pulse/status?location[directory]=.' \
  --data '{"input":{"providerID":"opencode-go","modelID":"deepseek-v4.1-flash"}}'
```

## Limitations

- The estimate refers to the moment the request **starts**; a long stream can cross a window boundary.
- If the holiday calendar is stale, the badge shows `▲?` instead of claiming peak. A false peak is worse than no hint.
- Prices are baked into plugin data. When the price list changes, update `src/data.ts` — the source and date are recorded there.
- `opencode-go` is confirmed: its price list has both Off-Peak and Peak rows.

## Development

```sh
npm install --no-save typescript @opencode/plugin@2.2.0 solid-js @opentui/core@0.6.6 @opentui/solid@0.6.6
./node_modules/.bin/tsc -p tsconfig.json
```

`src/tariff.ts` has no SDK imports and can be exercised with a plain Node script.
