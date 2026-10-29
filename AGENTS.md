# AGENTS.md

A repository of plugins for OpenCode V2. It currently contains two plugins: `plugins/tariff-pulse` and `plugins/usage-lens`. There is no build, linter or CI. Dev dependencies live in the root `package.json`: `npm run check` type-checks every plugin and `npm test` runs the unit tests on the built-in `node:test` runner — do not add a test framework or invent other commands.

## Target version

- OpenCode V2 (verified on v2.2.0). Use `@opencode/plugin` and `Plugin.define({ id, setup })`.
- V1 plugins (`@opencode-ai/plugin`, a function-style plugin, the `"plugin"` field in config) do not run on V2. Do not copy V1 examples and do not mix the APIs.
- Verify the API against https://opencode.ai/v2/docs/build/plugins and https://opencode.ai/v2/docs/build/plugins/server, not against V1 documentation.

## Layout

- `plugins/<name>/` — one plugin per directory.
- Entry point: `src/index.ts` with `export default Plugin.define(...)` and a stable `id` (`ctx.storage` and diagnostics depend on it).
- Convention: `src/index.ts` + `package.json` (`"type": "module"`, `exports` — at least `"."`, plus `"./tui"`, `"./rpc"`, `"./gui-experimental"` when present, dependency `@opencode/plugin`). Without `package.json`, OpenCode looks for an entry in the directory root (`index.ts`, `server.ts`), so `src/index.ts` without `exports` will not load.
- A `plugins/` directory next to the root config is not scanned automatically (autoload applies only to `.opencode/plugins/`). For local checks, add the directory to `opencode.json`:
  `{ "$schema": "https://opencode.ai/config.json", "plugins": ["./plugins/<name>"] }`
  The path must point to the directory, not to a file.

## Checking

- Local `.ts` plugins load without a build.
- `npm run check` type-checks everything (`tsc`, `noUnusedLocals` on). `npm test` runs the unit tests.
- Tracked config and plugins reload automatically. If changes are not picked up (local dependencies or directories outside watched paths) — `opencode service restart`, then `opencode service status`.
- Load and hook errors: `~/.local/share/opencode/log/opencode.log`; for detail, run with `OPENCODE_LOG_LEVEL=DEBUG`.
- Published packages are installed with `opencode plugin add <package>@<version>`; local ones only through `plugins` in the config. These plugins are not published yet.
- Automated tests cover only the pure tariff logic (`plugins/tariff-pulse/test/`). Everything else is verified by loading the plugin in OpenCode and calling its tool/hook manually. Do not add a test framework; extend the existing `node:test` files instead (`npm test` picks up `plugins/*/test/*.test.ts`).

## Tests

Write tests for code that requires them:

- Pure logic with branching, time and date math, pricing, scheduling, forecasting, parsing or normalization ships with tests. If a change touches such code, the change includes a test.
- Skip tests where they add no signal: TUI layout, plugin wiring (`setup`, hooks, RPC registration) and thin adapters. Verify those by loading the plugin in OpenCode (see `CONTRIBUTING.md`).
- Use the built-in `node:test` runner with native type stripping; do not add a framework or another runner.
- Keep tests deterministic: fixed timestamps, explicit time zones, no dependence on the machine clock. The only exception is a deliberate canary, such as the bundled holiday calendar expiry check.
- A bug in tested logic starts with a failing test. UI and wiring bugs are covered by the manual checklist.
- `plugins/tariff-pulse/test/tariff.test.ts` is the reference for style and scope. New pure modules in `usage-lens` (`forecast.ts`, `budget.ts`) belong in `plugins/usage-lens/test/` in the same style.

## API pitfalls

- `setup(ctx)` may return a cleanup function; cancel `ctx.event.subscribe()` subscriptions through an `AbortController`.
- `*.transform(...)` callbacks are synchronous, cheap and repeatable: no one-off side effects. Load external data before the transform and call the relevant domain's `reload()` when it changes.
- Tool: `input` is a JSON Schema, `execute` returns `{ content }`; pass `context.signal` for cancellable requests. The effective name includes the namespace (`acme_greeting`).
- Hooks are registered on a domain (`ctx.session.hook`, `ctx.tool.hook`, `ctx.shell.hook`), not returned as an object like in V1.
- `ctx.session.hook("context")` only affects the main agent loop; compaction, title and `generate` need their own hooks.
- For publishing, pin an `@opencode/plugin` version compatible with the target OpenCode release.

## Repository rules

- Documentation is English-first. `README.md` is the primary README, `README.ru.md` is its Russian mirror; keep both in sync, including the per-plugin READMEs when user-visible behavior changes.
- Update `CHANGELOG.md` under `Unreleased` for user-visible changes.
- Do not commit `docs/` — it holds personal research notes and is excluded locally through `.git/info/exclude`.
- Never send user data off the machine: both plugins read local OpenCode APIs only. The single exception is the tariff holiday calendar, a plain GET to the configured `holidayURL` that carries the year and nothing else; it runs on `/tier refresh` and, unless `autoHolidays` is `false`, once at launch while the stored calendar is stale.
- Keep pure logic (scheduling, pricing, forecasting) in modules without SDK imports so it can run under plain Node.

## Git

- Do not create commits unless the user explicitly asks. Leave changes in the working tree.
