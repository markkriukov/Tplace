# TPlace

Маркетплейс Telegram-подарунків у вигляді Telegram Mini App.

| Компонент | Технології | Каталог |
|---|---|---|
| Фронтенд | React + Vite | `frontend/` |
| API | Node.js 24, Express, Sequelize | `backend/node/` |
| Telegram-воркер | Python 3.14, Kurigram | `backend/python-worker/` |
| База даних | PostgreSQL 18 | `backend/db/migrations/` |

## Швидкий запуск (локально, без Telegram)

1. Створіть файл налаштувань:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Заповніть у `.env`:

   - `JWT_SECRET`: випадковий рядок довжиною щонайменше 32 байти. Згенерувати можна так:
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `CUSTODY_TELEGRAM_USER_ID`: Compose вимагає це значення завжди. Для локальної перевірки підійде будь-яке додатне число.
   - `ALLOW_DEV_AUTH=true` і `VITE_ALLOW_DEV_AUTH=true`: вхід без Telegram (працює лише на localhost).

3. Запустіть базу, міграції, API та фронтенд:

   ```powershell
   docker compose up -d --build frontend
   ```

4. Відкрийте застосунок: http://localhost:5173

   - API: http://localhost:4000/health
   - Опис API (OpenAPI): http://localhost:4000/openapi.json

Щоб видати тестовому користувачу (Telegram ID `100001`) права адміністратора:

```powershell
docker exec -e OPERATOR_ID=local tplace-backend-node npm run users:admin -- 100001 true
```

## Повний запуск (з Telegram-воркером)

1. Додатково заповніть у `.env`:
   - `TELEGRAM_BOT_TOKEN`: токен бота Mini App.
   - `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`: значення з https://my.telegram.org.
   - `CUSTODY_TELEGRAM_USER_ID`: ID акаунта, на якому зберігаються подарунки.
2. Один раз авторизуйте сесію цього акаунта (інтерактивно, із кодом підтвердження з Telegram):

   ```powershell
   docker compose run --rm backend-python python create_session.py
   ```

   Сесія зберігається у `backend/python-worker/runtime/`.
3. Запустіть усі сервіси (разом із pgAdmin на http://localhost:5050):

   ```powershell
   docker compose up -d --build
   ```

4. Telegram відкриває Mini App лише через HTTPS. Для цього вкажіть `TUNNEL_TOKEN` (Cloudflare Tunnel, hostname тунелю має вести на `http://frontend:5173`) і запустіть:

   ```powershell
   docker compose --profile tunnel up -d
   ```

   Домен `dev.tplace.store` прописаний у `docker-compose.yml` (`__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`) і у `VITE_TONCONNECT_APP_URL`. Якщо у вас інший домен, замініть його в обох місцях.

TON-платежі (`TON_*`) необов'язкові. Поки `TON_TREASURY_ADDRESS` порожній, поповнення гаманця вимкнене.

## Тести

```powershell
.\scripts\test-backend.ps1        # бекенд (Node + Python) на тимчасовій PostgreSQL, порт 55432
cd frontend; npm ci; npm test     # фронтенд
```

Для тестів бекенду спершу виконайте `npm ci` у `backend/node` і встановіть залежності з `backend/python-worker/requirements.txt`.

## Корисні команди

```powershell
docker compose logs -f backend-node      # логи API
docker restart tplace-backend-node       # обов'язково після змін у коді бекенду
docker compose down                      # зупинити (дані БД зберігаються)
docker compose down -v                   # зупинити й видалити дані
```

На Windows контейнер API не помічає змін у файлах, тому після правок у коді бекенду його треба перезапускати. Фронтенд оновлюється сам.

Продакшн-конфігурація: `docker-compose.prod.yml`. Змінні беруться з `.env.production`, секрети лежать у `deploy/secrets/`.
