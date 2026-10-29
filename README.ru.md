# opencode-plugins

[English](README.md) · **Русский**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-v2.2.0-6b5bff.svg)](https://opencode.ai)
[![Status](https://img.shields.io/badge/status-beta-orange.svg)](#статус)

Два плагина для [OpenCode](https://opencode.ai) V2, которые отвечают на два вопроса о цене прямо в TUI:

- **Сейчас пиковая цена?** → `tariff-pulse`
- **Сколько осталось от лимита и к чему он идёт?** → `usage-lens`

Оба работают только на чтение ваших данных, не отправляют телеметрию и подключаются независимо.

> Основная документация — английская ([README.md](README.md)). Этот файл — её русская версия.

## Плагины

| Плагин | Что делает | Части OpenCode | Команда |
|---|---|---|---|
| [tariff-pulse](plugins/tariff-pulse/README.md) | Пиковый/льготный тариф DeepSeek: бейдж у композера, страница с расписанием, обратный отсчёт до смены окна | server + TUI + RPC | `/tier` |
| [usage-lens](plugins/usage-lens/README.md) | Панель лимитов и расхода в сайдбаре: лимит Go или бюджеты Console, темп, прогноз, дата сброса, разбивка по моделям | server + TUI + RPC | `/limits` |

### Как это выглядит

```
# композер, tariff-pulse
▲ PEAK ×2 · 1h 42m        сейчас дорого; льгота через 1 ч 42 мин
▼ OFF −50% · 3h 05m       сейчас льгота
▲? PEAK ×2 · 2h 10m       календарь праздников устарел — цена под вопросом
```

```
# сайдбар, usage-lens
usage · Go
73% ███████░
on pace 87% by reset
reset 9d · 5h 41% · wk 62%
today $3.42 · 14 steps · 150k
```

## Требования

- **OpenCode V2** — разработка и проверка на `2.2.0`. V1-плагины используют другой API и несовместимы.
- `tariff-pulse` требует провайдера с DeepSeek (`deepseek` или `opencode-go` по умолчанию; варианты моделей `-free` не матчатся — у них нет цены за токены).
- `usage-lens` требует выполненного входа в OpenCode Console; без него панель показывает `not connected`, а не падает. Подписка Go не обязательна: без неё лимитом выступают бюджеты Console.

## Установка

Плагины пока не опубликованы в npm. Склонируйте репозиторий и укажите OpenCode каталоги плагинов:

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

Чтобы подключить только один плагин, оставьте только его запись. Локальный путь отсчитывается от файла конфига и указывает на **каталог** плагина, а не на файл.

Если конфиг или плагины лежат вне отслеживаемых путей, перезапустите сервис:

```sh
opencode service restart
opencode service status
```

## Как это работает

**tariff-pulse** хранит расписание DeepSeek (пик `01:00–04:00` и `06:00–10:00` UTC, Пн–Пт; праздники КНР — льгота весь день) и таблицу цен для известных моделей. Льгота ровно вдвое дешевле пика. Каталог моделей OpenCode показывает **льготную** цену, поэтому бейдж важен: в пик реальная стоимость вдвое выше той, что видно в списке моделей. Когда встроенный календарь праздников просрочен, бейдж переходит в `▲?` и не утверждает, что сейчас пик.

**usage-lens** читает `GET /api/experimental/usage/limits` (лимиты Go и бюджеты Console) и `GET /api/experimental/session/stats` (расход, токены и разбивка по моделям за сегодня). При активной подписке показывается лимит Go, иначе лимитом выступают бюджеты Console: процент, `spent/limit`, дата сброса и разбивка по моделям. Снапшоты процентов хранятся локально и дают измеренный темп; прогноз месячного лимита линейно растягивается к `resetsAt` так же, как в Console. Ошибки изолированы: вызовы ограничены таймаутом, а неудачное обновление сохраняет последние удачные числа с пометкой `stale` и причиной, не ломая сессию.

## Структура репозитория

```
plugins/<name>/
  package.json      # type: module, exports: ".", "./tui", "./rpc"
  src/index.ts      # server: Plugin.define({ id, setup })
  src/tui.tsx       # TUI-часть
  src/rpc.ts        # RPC-контракт для обеих частей
  src/*.ts          # чистая логика без импортов SDK
  test/*.test.ts    # юнит-тесты чистой логики (tariff-pulse)
```

Чистые модули (`tariff.ts`, `forecast.ts`) не зависят от SDK и запускаются обычным скриптом на Node. Часы тарифа покрыты юнит-тестами на встроенном раннере Node.

## Разработка

Сборки, линтера и CI нет. Локальные `.ts`-плагины загружаются без сборки. Тесты используют `node:test` и требуют Node с нативным стриппингом типов (`22.18+`, проверено на `24`).

```sh
# проверка типов и юнит-тесты (dev-зависимости в корневом package.json)
npm install
npm run check
npm test

# загрузились ли оба плагина
opencode api get "/api/plugin?location[directory]=$PWD"

# прямой вызов RPC
opencode api post "/api/rpc/tariff_pulse/status?location[directory]=$PWD" \
  --data '{"input":{"providerID":"opencode-go","modelID":"deepseek-v4.1-flash"}}'
```

Ошибки времени выполнения пишутся в `~/.local/share/opencode/log/opencode.log`; для деталей по хукам запускайте с `OPENCODE_LOG_LEVEL=DEBUG`.

Правила и чек-лист ручной проверки — в [CONTRIBUTING.md](CONTRIBUTING.md).

## Статус

Ранняя версия (`0.1.x`). Плагины опираются на `experimental.*` эндпоинты и на таблицу цен, актуальную на **2026-10-27**. При изменении прайса DeepSeek нужно обновить `plugins/tariff-pulse/src/data.ts`. До `1.0` интерфейсы могут меняться между минорными версиями.

## Лицензия

[MIT](LICENSE) © 2026 Alexander Malinov
