# Telegram announcement draft

Draft of the launch post for the author's Telegram channel. ~1400 chars,
Telegram-friendly formatting: plain line breaks, minimal emoji, no heavy
markdown (bold/italics render differently across clients).

Edit freely before posting — this is just the version that matched the
spirit of the project at launch.

---

Claude Code CLI — лучший инструмент года. Но в феврале и апреле
Anthropic закрыл дверь к автоматизации через подписку: OAuth-токены
Pro/Max больше нельзя использовать в third-party tools, self-built
orchestrators или Agent SDK. Consumer Terms требуют "ordinary,
individual usage".

Реакция сообщества расслоилась. Одни побежали оборачивать claude
в proxy-сервера, чтобы обойти. Другие молча ушли на API-биллинг.
Мне не нравятся оба пути: один нечестный, второй дорогой для
one-man проектов.

Я выбрал третий. Факт: я реально могу открыть 5 терминалов с claude
и вести 2–3 проекта параллельно. Это обычный power-user паттерн.
Если автоматизация НЕ ПРЕВЫШАЕТ его ни по одному измерению —
ни по параллелизму, ни по темпу, ни по суточной нагрузке — она
неотличима от меня живого. И по букве, и по духу.

Так родился pinch — маленькая библиотека для Node и Python,
которую кладёшь в свой проект, и она архитектурно не даёт превысить
потолок сольного разработчика:

  • максимум 5 параллельных сессий глобально
  • максимум 3 на проект, максимум 3 активных проекта
  • минимум 8 часов тишины в сутки (сон)
  • spawn delay 15–30 секунд с джиттером
  • cooldown между волнами 2–5 минут

Эти числа — hard invariants. Валидатор кидает ошибку, если конфиг
пытается их расслабить. Принципиально: нельзя legitimate-решение
превратить в loophole одним флагом — иначе это уже fork.

Auth-agnostic: работает с подпиской И с API-ключом. Лимиты полезны
обоим: подписчика защищают от риска бана, API-юзера от неожиданного
счёта.

Zero runtime dependencies. MIT. Аудитится за час.

Это не "как обмануть Anthropic". Это "как автоматизировать себя,
оставаясь собой".

npm install itsalt-pinch
pip install itsalt-pinch

🔗 github.com/ITSalt/pinch
