# Contributing

Thanks for taking the time to improve these plugins. Issues and pull requests are welcome.

## Before you start

- This repository targets **OpenCode V2** (`2.2.0` at the time of writing). V1 plugin APIs are out of scope.
- There is no build step, linter or CI. Pure logic is covered by the built-in `node:test` runner (`plugins/tariff-pulse/test/`). Do not add a test framework or another runner unless the maintainer agrees in the issue first.
- Keep pull requests focused: one plugin or one concern per PR.

## Getting set up

```sh
git clone https://github.com/xmalinov/opencode-plugins.git
cd opencode-plugins
```

Enable the plugins locally through `opencode.json` (already present in the repository, pointing at `./plugins/*`), then start OpenCode from the repository root.

Dev dependencies are installed without touching `package.json`:

```sh
npm install --no-save typescript @types/node @opencode/plugin@2.2.0 solid-js @opentui/core@0.6.6 @opentui/solid@0.6.6
./node_modules/.bin/tsc -p tsconfig.json
```

`tsc` runs with `noEmit`; there is no artifact to publish from this repository. Each plugin's `src/index.ts` is loaded as-is by OpenCode.

Unit tests cover the tariff clock and its bundled data (`plugins/tariff-pulse/test/tariff.test.ts`). They use the built-in Node runner, so no test dependency is installed:

```sh
node --test plugins/tariff-pulse/test/tariff.test.ts
```

Node needs native type stripping for this (`22.18+`, verified on `24`).

## Layout

```
plugins/<name>/
  package.json      # type: module; exports ".", "./tui", "./rpc"
  src/index.ts      # server entry: Plugin.define({ id, setup })
  src/tui.tsx       # TUI entry
  src/rpc.ts        # RPC contract shared by both entries
  src/*.ts          # pure logic, no SDK imports
```

Rules that keep the code testable and the two entries in sync:

- `src/index.ts` and `src/tui.tsx` both import the same `src/rpc.ts` contract.
- Pure logic (scheduling, pricing, forecasting) belongs in modules without SDK imports.
- New pure logic ships with tests in `test/`; `plugins/tariff-pulse/test/tariff.test.ts` is the reference for style and scope.
- Only `setup(ctx)` should touch `ctx`; register hooks on their domain (`ctx.session.hook`, `ctx.tool.hook`, `ctx.shell.hook`), not as a returned object.
- `*.transform(...)` callbacks are synchronous, cheap and repeatable: no one-off side effects there. Load data before the transform and call `reload()` when it changes.
- Never send user data off the machine. Both plugins are local-only by design.

## Manual verification

Unit tests cover only the tariff clock; everything else is verified by loading the plugin and calling it. Plugin RPCs are scoped to a location, so pass an absolute directory — `$PWD` from the repository root.

```sh
# both plugins present and loaded
opencode api get "/api/plugin?location[directory]=$PWD"

# tariff-pulse
opencode api post "/api/rpc/tariff_pulse/status?location[directory]=$PWD" \
  --data '{"input":{"providerID":"opencode-go","modelID":"deepseek-v4.1-flash"}}'
opencode api post "/api/rpc/tariff_pulse/schedule?location[directory]=$PWD" --data '{"input":{}}'

# usage-lens
opencode api post "/api/rpc/usage_lens/history?location[directory]=$PWD" --data '{"input":{}}'
```

In the TUI, check `/tier` and `/limits`, plus at least one option you touched (`compact`, `slot`, `providers`, `nearChangeMinutes`).

If changes do not load, restart the service and inspect the log:

```sh
opencode service restart
opencode service status
tail -f ~/.local/share/opencode/log/opencode.log   # OPENCODE_LOG_LEVEL=DEBUG for hook detail
```

## Style

- TypeScript, ESM, `strict` mode. No `any` in public surfaces; `jsonClone`-style helpers are the only pragmatic exception.
- Match the surrounding style: no semicolons, double quotes, two-space indentation, `type` imports where possible.
- Comments explain *why* a decision was made, not *what* the next line does. Keep them short.
- User-facing strings and docs are written in English. `README.ru.md` is the Russian mirror of the root README; keep both in sync when user-visible behavior changes.
- Update the relevant `README.md` and `CHANGELOG.md` (`Unreleased`) in the same PR.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `fix(tariff-pulse): ...`, `feat(usage-lens): ...`, `docs: ...`, `chore: ...`.
- Describe the user-visible effect and how you verified it. Screenshots or terminal captures of TUI changes are appreciated.
- Note any known limitation rather than hiding it.

## Reporting bugs

Use the issue templates. Include the OpenCode version (`opencode --version`), operating system, plugin options, expected vs. actual behavior, and relevant log lines with secrets removed.
