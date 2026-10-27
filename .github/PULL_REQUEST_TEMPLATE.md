## What changed

<!-- One or two sentences. Which plugin, which behavior. -->

## Why

<!-- The problem this solves. Link the issue if there is one: Closes #123 -->

## How I verified it

<!--
Unit tests cover only the tariff clock, so describe the manual check too:
- ./node_modules/.bin/tsc -p tsconfig.json
- node --test plugins/tariff-pulse/test/tariff.test.ts (if the tariff changed)
- which commands (/tier, /limits) and options you exercised
- relevant RPC calls and their output
-->

## Checklist

- [ ] `tsc -p tsconfig.json` passes
- [ ] `node --test plugins/tariff-pulse/test/tariff.test.ts` passes if the tariff logic or data changed
- [ ] The affected plugin loads in OpenCode V2 and the change is visible in the TUI
- [ ] `README.md` / `README.ru.md` / plugin README updated if behavior or options changed
- [ ] `CHANGELOG.md` updated under `Unreleased` for user-visible changes
- [ ] No secrets, tokens or private paths in code, logs or screenshots
