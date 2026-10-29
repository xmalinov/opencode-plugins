# opencode-plugins

**English** · [Русский](README.ru.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-v2.2.0-6b5bff.svg)](https://opencode.ai)
[![Status](https://img.shields.io/badge/status-beta-orange.svg)](#status)

Two plugins for [OpenCode](https://opencode.ai) V2 that answer two cost questions inside the TUI:

- **Am I paying peak price right now?** → `tariff-pulse`
- **How much of my allowance is left, and where is it heading?** → `usage-lens`

Both are read-only toward your data, ship no telemetry, and work independently.

## Plugins

| Plugin | What it does | OpenCode parts | Command |
|---|---|---|---|
| [tariff-pulse](plugins/tariff-pulse/README.md) | DeepSeek peak/off-peak tariff: badge near the composer, full schedule page, countdown to the next price window | server + TUI + RPC | `/tier` |
| [usage-lens](plugins/usage-lens/README.md) | Allowance and spend panel in the sidebar: Go allowance or Console budgets, pace, forecast, reset date, per-model split | server + TUI + RPC | `/limits` |

Both plugins also give the agent a tool — `tariff.status` and `usage.forecast` — so it can answer the same questions ("is it peak now?", "how fast is the allowance going?") without opening a panel. Neither tool makes a network request. They are not free: together they add about 210 tokens of tool schema to every request and one model request per call.

### What it looks like

```
# composer, tariff-pulse
▲ PEAK ×2 · 1h 42m        now costs double; off-peak in 1h 42m
▼ OFF −50% · 3h 05m       off-peak now
▲? PEAK ×2 · 2h 10m       holiday calendar is stale — price uncertain
```

```
# sidebar, usage-lens
usage · Go
73% ███████░
on pace 87% by reset
reset 9d · 5h 41% · wk 62%
today $3.42 · 14 steps · 150k
```

## Requirements

- **OpenCode V2** — developed and verified against `2.2.0`. V1 plugins use a different API and are not compatible.
- `tariff-pulse` needs a DeepSeek-backed provider (`deepseek` or `opencode-go` by default; `-free` model variants are not matched, since they have no per-token price).
- `usage-lens` needs a signed-in OpenCode Console session; without it the panel shows `not connected` instead of failing. A Go subscription is optional: without it Console budgets act as the limit.

## Installation

The plugins are not published to npm yet. Clone the repository and point OpenCode at the plugin directories:

```sh
git clone https://github.com/xmalinov/opencode-plugins.git
```

```jsonc title="opencode.jsonc"
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "./opencode-plugins/plugins/tariff-pulse",
    {
      "package": "./opencode-plugins/plugins/usage-lens",
      "options": { "compact": false }
    }
  ]
}
```

Use one plugin alone by keeping only its entry. Local paths are resolved relative to the config file and must point to the **plugin directory**, not to a file.

Restart the background service if the config or plugins are outside watched paths:

```sh
opencode service restart
opencode service status
```

## How it works

**tariff-pulse** encodes the DeepSeek schedule (peak `01:00–04:00` and `06:00–10:00` UTC, Mon–Fri; PRC holidays are off-peak all day) and the price table for the models it knows. Off-peak is exactly half of peak. The model catalogue in OpenCode lists the **off-peak** price, so the badge matters: during peak the real cost is twice what the model picker shows. When the bundled holiday calendar expires, the badge degrades to `▲?` instead of claiming peak.

**usage-lens** reads `GET /api/experimental/usage/limits` for Go allowance and Console budgets, and `GET /api/experimental/session/stats` for today's spend, tokens and per-model split. A Go allowance is shown when the subscription is active; otherwise the workspace's Console budgets act as the limit (percent, spent/limit, reset and per-model split). It stores percentage snapshots locally to compute a measured pace, and projects the monthly limit linearly toward `resetsAt` the same way the Console does. Errors are contained: calls time out, and a failed refresh keeps the last good numbers with a `stale` marker and the reason instead of breaking the session.

## Repository layout

```
plugins/<name>/
  package.json      # type: module, exports: ".", "./tui", "./rpc"
  src/index.ts      # server entry: Plugin.define({ id, setup })
  src/tui.tsx       # TUI entry
  src/rpc.ts        # RPC contract shared by both entries
  src/*.ts          # pure logic, no SDK imports
  test/*.test.ts    # unit tests for the pure logic
```

Pure modules (`tariff.ts`, `forecast.ts`, `budget.ts`, `view.ts`) have no SDK imports and can be exercised with plain Node. The tariff clock, the error phrases, the forecast text and the `/limits` page are covered by unit tests on the built-in Node test runner.

## Development

There is no build step, linter or CI. Local `.ts` plugins load directly. Tests use `node:test` and need a Node with native type stripping (`22.18+`, verified on `24`).

```sh
# type-check and unit tests (dev dependencies live in the root package.json)
npm install
npm run check
npm test

# confirm both plugins loaded
opencode api get "/api/plugin?location[directory]=$PWD"

# call an RPC method directly
opencode api post "/api/rpc/tariff_pulse/status?location[directory]=$PWD" \
  --data '{"input":{"providerID":"opencode-go","modelID":"deepseek-v4.1-flash"}}'
```

Runtime errors are written to `~/.local/share/opencode/log/opencode.log`; run with `OPENCODE_LOG_LEVEL=DEBUG` for hook-level detail.

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and the manual verification checklist.

## Status

Early (`0.1.x`). The plugins rely on `experimental.*` endpoints and on a price table that is valid as of **2026-10-27**. When DeepSeek changes prices, `plugins/tariff-pulse/src/data.ts` needs an update. Interfaces may change between minor versions until `1.0`.

## License

[MIT](LICENSE) © 2026 Alexander Malinov
