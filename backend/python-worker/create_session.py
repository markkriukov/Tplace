"""Create the persistent Kurigram user session used by the worker.

Run interactively: python backend/python-worker/create_session.py
Set TELEGRAM_API_ID and TELEGRAM_API_HASH in the root .env or environment.
Session location uses the worker environment settings.
"""

import asyncio
import os


async def create_session() -> None:
    from config import SESSION_NAME, SESSION_WORKDIR
    from integrations.telegram_client import create_telegram_client

    async with create_telegram_client() as client:
        user = await client.get_me()
        if user.is_bot:
            raise RuntimeError('The worker requires a user account session, not a bot session.')
        telegram_id = user.id
        username = f'@{user.username}' if user.username else '(no username)'

    print(f'Authorized account: {telegram_id} {username}')
    print(f'Session saved: {(SESSION_WORKDIR / (SESSION_NAME + ".session")).resolve()}')


def main() -> None:
    print('Stop the worker before opening the same session file.')
    api_id = (os.getenv('TELEGRAM_API_ID') or '').strip()
    if not api_id.isascii() or not api_id.isdigit() or int(api_id) <= 0:
        raise ValueError('Set TELEGRAM_API_ID to a positive integer.')

    api_hash = (os.getenv('TELEGRAM_API_HASH') or '').strip()
    if not api_hash:
        raise ValueError('Set TELEGRAM_API_HASH.')

    asyncio.run(create_session())


if __name__ == '__main__':
    from environment import load_project_environment

    load_project_environment()
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        raise SystemExit('\nAuthorization canceled.')
