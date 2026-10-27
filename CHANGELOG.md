# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `usage-lens`: Console budgets act as the limit when there is no Go or Go Plus subscription.
  - Sidebar shows the budget percentage, bar, spent/limit and reset date.
  - `/limits` lists every budget with coverage, scope, remaining amount, reset and per-model spend.
  - The primary budget is the one picked in the Console, then one covering the selected model, then the first one.

### Fixed

- `usage-lens`: an empty compact meter is no longer colored as a healthy limit.

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
