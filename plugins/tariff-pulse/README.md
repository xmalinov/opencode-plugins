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

A stale holiday calendar is refreshed in the background at launch, without a toast: the badge would otherwise stay at `▲?` until someone remembered `/tier refresh`. The request is made only while the stored calendar is stale.

## Agent tools

`tariff.status` gives the same facts to the agent — tier, reason, countdown, prices on both sides of the next change, schedule — so it can answer "send it now or wait" without opening `/tier`. The session's model is used unless `providerID`/`modelID` are passed. It reads local data only: no API call.

## Cost

The badge and the `/tier` page run in the TUI: no model tokens, no model requests.

`tariff.status` adds about 133 tokens of tool schema to every request and costs one model request per call — about $0.0012 on `deepseek-v4.1-flash` off-peak with a 130k-token context. The answer is about 80 tokens and stays in the session history.

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
| `holidayURL` | `https://timor.tech/api/holiday/year/<year>` | source used by `/tier refresh` and the background refresh |
| `autoHolidays` | `true` | refresh a stale calendar in the background at launch; `false` keeps the plugin fully offline until `/tier refresh` |

## RPC

| Method | Purpose |
|---|---|
| `status({ providerID, modelID, at? })` | current tier, prices, next change |
| `schedule()` | windows, calendar, price source |
| `setHolidays({ dates, validUntil, source? })` | store a refreshed calendar |

```sh
opencode api post "/api/rpc/tariff_pulse/status?location[directory]=$PWD" \
  --data '{"input":{"providerID":"opencode-go","modelID":"deepseek-v4.1-flash"}}'
```

## Limitations

- The estimate refers to the moment the request **starts**; a long stream can cross a window boundary.
- If the holiday calendar is stale, the badge shows `▲?` instead of claiming peak. A false peak is worse than no hint.
- Prices are baked into plugin data. When the price list changes, update `src/data.ts` — the source and date are recorded there.
- `opencode-go` is confirmed: its price list has both Off-Peak and Peak rows.
- Free model variants are not matched on purpose: a `-free` model has no per-token price, so a peak multiplier would misrepresent its cost. Aliases name paid models only.
- Model ids are matched by a normalized key: case and punctuation are ignored, and so is a snapshot suffix (`deepseek-flash-1017` is `deepseek-flash`). Labels are not ignored — `-free` stays a different model.
- The provider list comes from `options.providers`, and OpenCode passes options only in the object form of the plugin entry. A plain string entry (`"./plugins/tariff-pulse"`) silently gets the defaults `["deepseek", "opencode-go"]`.

## Development

```sh
npm install
npm run check
npm test
```

`src/tariff.ts` has no SDK imports; `test/tariff.test.ts` covers it with the built-in Node test runner (Node `22.18+` for native type stripping, verified on `24`).
