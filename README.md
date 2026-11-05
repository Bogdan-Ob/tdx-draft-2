# TDX PvP Draft

Сайт для совместного драфта колод Tower Defense X (режим Wheel Draft). Два игрока с разных компьютеров,
синхронизация через бесплатный Firebase Realtime Database, хостинг на GitHub Pages.

## Запуск на GitHub Pages
1. Загрузите все файлы из этой папки в корень репозитория `Bogdan-Ob/tdx-draft-2` (ветка `main`).
2. Repository → Settings → Pages → Source: *Deploy from a branch*, Branch: `main`, папка `/ (root)` → Save.
3. Через минуту сайт откроется на `https://bogdan-ob.github.io/tdx-draft-2/`.

## Firebase (один раз)
Конфиг уже в `firebase-config.js`. Данные этого сайта лежат ТОЛЬКО по пути `tdx-draft/main`,
поэтому прежние данные вашего другого проекта в этой базе чистить не нужно.

Откройте Firebase Console → проект `tdx-draft` → Realtime Database → вкладка **Rules** и **добавьте**
блок `tdx-draft` внутрь существующих `rules` (остальное не удаляйте):

```json
{
  "rules": {
    "tdx-draft": { ".read": true, ".write": true }
  }
}
```
(готовый пример — `database.rules.json`). Нажмите **Publish**.
Если вы раньше ограничивали базу по домену, добавьте `bogdan-ob.github.io` в Authentication → Settings → Authorized domains
и, если ключ ограничен, в Google Cloud Console → Credentials → HTTP referrers.

Это бесплатный план Spark. Правила открытые: любой, кто знает адрес базы, может писать в `tdx-draft`.
Для игры с друзьями этого достаточно; для публичного сайта нужна авторизация.

## Как играть
Оба игрока открывают сайт, один занимает Blue, другой Red. Каждый крутит своё колесо 10 раз, затем решает
по «подлянке» и собирает колоду из 6 башен. Когда оба подтвердили, драфт завершён.
«Сбросить драфт» очищает всё. Если комната «зависла», смените `FIREBASE_ROOT` в `firebase-config.js`.

## Иконки башен
На своём компьютере запустите `python fetch-icons.py` из папки проекта — скрипт скачает иконки в `icons/`
и обновит `icons/index.json`. Затем загрузите папку `icons/` в репозиторий. Без иконок сайт показывает цветные бейджи.

## Где что менять
- `towers.js` — список башен и статусы (`pvp` / `banned` / `event`).
- `wheel-logic.js` — параметры колеса: `SLOTS`, `SPIN_MS`, `BASE_STEPS`, `FAST_SHARE`, `FAST_DECAY` (кривая скорости).
- `app.js` — правила драфта (`CFG`), интерфейс, отрисовка колеса.
- `net.js` — слой Firebase. `style.css` — стили по разделам.
