from contextlib import asynccontextmanager

from pyrogram import Client, raw
from pyrogram.enums import ClientPlatform
from config import API_HASH, API_ID, CUSTODY_TELEGRAM_USER_ID, SESSION_NAME, SESSION_WORKDIR


def create_telegram_client(*, receive_updates: bool = False) -> Client:
    if not API_ID or not API_HASH:
        raise RuntimeError('Missing TELEGRAM_API_ID/TELEGRAM_API_HASH')
    SESSION_WORKDIR.mkdir(parents=True, exist_ok=True)
    return Client(
        name=SESSION_NAME,
        workdir=str(SESSION_WORKDIR),
        api_id=int(API_ID),
        api_hash=API_HASH,
        system_version='SDK 31',
        device_model='Samsung SM-G998B',
        client_platform=ClientPlatform.ANDROID,
        lang_code='ru',
        system_lang_code='ru',
        lang_pack='jabka',
        sleep_threshold=120,
        skip_updates=not receive_updates,
        no_updates=not receive_updates,
    )


@asynccontextmanager
async def listening_client(client):
    """Start update dispatch for an existing session without interactive login."""
    try:
        if not await client.connect():
            raise RuntimeError('TELEGRAM_AUTH_REQUIRED: authorize account.session before starting the worker')
        client.me = await client.get_me()
        if client.me.is_bot:
            raise RuntimeError('Custody requires a Telegram user account')
        if CUSTODY_TELEGRAM_USER_ID and str(client.me.id) != CUSTODY_TELEGRAM_USER_ID:
            raise RuntimeError('CUSTODY_ACCOUNT_MISMATCH: session account does not match CUSTODY_TELEGRAM_USER_ID')
        await client.invoke(raw.functions.updates.GetState())
        await client.initialize()
        yield client
    finally:
        if client.is_initialized:
            await client.terminate()
        if client.is_connected:
            await client.disconnect()
