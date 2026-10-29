# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `tariff-pulse` and `usage-lens`: the agent can answer the panels' questions itself.
  - `tariff.status` reports the tier, the reason, the time to the next change, the prices on both sides of it and the weekly schedule. It uses the session's model unless `providerID`/`modelID` are given.
  - `usage.forecast` reports the monthly, weekly and 5-hour percentages of the last reading, the measured rate and the time to the limit, and says how old the reading is — only the panel records readings.
  - Both read what the panel already has: neither makes a new request.
- `tariff-pulse`: a stale holiday calendar is refreshed in the background at launch (`autoHolidays`, on by default). Without it the badge stayed at `▲?` after the bundled calendar expired until someone ran `/tier refresh`; the request is made only while the stored calendar is stale, and a background failure goes to the log instead of a toast.
- `usage-lens`: Console budgets act as the limit when there is no Go or Go Plus subscription.
  - Sidebar shows the budget percentage, bar, spent/limit and reset date.
  - `/limits` lists every budget with coverage, scope, remaining amount, reset and per-model spend.
  - The primary budget is the one picked in the Console, then one covering the selected model, then the first one.

### Removed

- `usage-lens`: the peak/off-peak line and the `tariff_pulse.status` call. `tariff-pulse` already shows the same badge near the composer, so the sidebar copy was duplication, and the line never appeared anyway because plugin RPC calls need a location. The panel no longer knows about the other plugin.

### Changed

- Docs: both plugin READMEs now state what the agent tools cost — about 210 tokens of tool schema per request and one model request per call — instead of calling them free.
- `tariff-pulse`: model ids are matched by a normalized key — case, punctuation and a snapshot suffix (`deepseek-flash-1017` is `deepseek-flash`) are folded, so a new DeepSeek snapshot resolves without adding an alias. Labels are not folded: `-free` stays a different model.
- Repository: dev dependencies moved to a root `package.json`; `npm run check` type-checks every plugin (`noUnusedLocals` on) and `npm test` runs the unit tests. Two dead imports in `usage-lens` were removed by the new check.

### Fixed

- `usage-lens`: `on pace` no longer disappears on the first day of a Go cycle — the Console hides its forecast there, so the panel falls back to the measured rate and shows `on pace —` when there is not enough data.
- `usage-lens`: a failed refresh no longer blanks the panel — the last good numbers stay, with the reason under them and a `stale` line once the reading is older than 5 minutes (`/limits` says the same). Before the first successful read the panel still shows `usage unavailable`.
- `tariff-pulse` and `usage-lens`: a failed request now says what happened — `sign in again (401)`, `rate limited (429)`, `timed out`, `network error` — instead of the raw message, and a long API body is cut to one line.
- `usage-lens`: the panel no longer freezes when a request hangs — the limits and stats calls time out after 15 seconds and release the busy flag.
- `usage-lens` and `tariff-pulse`: semantic colours come from the first theme token that exists (`text.feedback.*` → syntax/diff hues) with hex fallbacks, so a theme without the feedback tokens no longer breaks the TUI half.
- `tariff-pulse`: `/tier refresh` always answers — the calendar fetch gives up after 10 seconds and the `setHolidays` sync after 15, so the toast appears instead of nothing.
- `usage-lens`: an empty compact meter is no longer colored as a healthy limit.
- `usage-lens`: snapshots are stored again — `usage_lens.ingest` was called without a location, so the server answered `rpc.unavailable` and the measured pace stayed empty.
- `usage-lens`: the panel reloads on `credential.updated`, so the allowance appears right after `opencode auth login` instead of on the next poll.
- `usage-lens`: a failed refresh can no longer leave the panel frozen — the busy flag is always released.
- `tariff-pulse`: `/tier refresh` now syncs the calendar with the server — the `setHolidays` RPC was called without a location, so the server answered `rpc.unavailable` while the toast claimed success. A local-only update is now reported as a warning instead of a success.

## [0.1.0] - 2026-10-27

### Added

- `tariff-pulse`: DeepSeek peak/off-peak tariff indicator for OpenCode V2.
  - Composer badge with tier, multiplier and countdown to the next window.
  - `/tier` page with the schedule, price table and holiday calendar state.
  - `/tier refresh` to fetch a new PRC holiday calendar from timor.tech.
  - `/tier test peak|off|live` to freeze the clock and check colors.
  - Options: `providers`, `nearChangeMinutes`, `holidays`, `holidayURL`.
  - RPC: `status`, `schedule`, `setHolidays`.
- `usage-lens`: allowance and spend panel for OpenCode V2.
  - Sidebar block (or compact single line) with monthly limit, reset, today's spend, tokens and per-model split.
  - `/limits` page (alias `/spend`) with budgets and forecast.
  - Linear `on pace` projection and a measured pace from local snapshots.
  - Optional tariff line when `tariff-pulse` is installed.
  - Options: `compact`, `plan`, `slot`.
  - RPC: `ingest`, `history`, `reset`.
- Documentation in English and Russian (`README.md`, `README.ru.md`).
- MIT license, contribution guide, code of conduct and issue templates.

[Unreleased]: https://github.com/xmalinov/opencode-plugins/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/xmalinov/opencode-plugins/releases/tag/v0.1.0
