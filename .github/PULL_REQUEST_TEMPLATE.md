## What changed

<!-- One or two sentences. Which plugin, which behavior. -->

## Why

<!-- The problem this solves. Link the issue if there is one: Closes #123 -->

## How I verified it

<!--
There is no automated test suite, so describe the manual check:
- tsc -p tsconfig.json
- which commands (/tier, /limits) and options you exercised
- relevant RPC calls and their output
-->

## Checklist

- [ ] `tsc -p tsconfig.json` passes
- [ ] The affected plugin loads in OpenCode V2 and the change is visible in the TUI
- [ ] `README.md` / `README.ru.md` / plugin README updated if behavior or options changed
- [ ] `CHANGELOG.md` updated under `Unreleased` for user-visible changes
- [ ] No secrets, tokens or private paths in code, logs or screenshots
