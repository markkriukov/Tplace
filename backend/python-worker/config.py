import os
from pathlib import Path

# Settings renamed without a fallback: a stale name must not be ignored silently.
RENAMED_SETTINGS = {
    'API_ID': 'TELEGRAM_API_ID',
    'API_HASH': 'TELEGRAM_API_HASH',
    'GIFT_SYNC_INTERVAL': 'CUSTODY_RECONCILE_INTERVAL_SECONDS',
}

SESSION_NAME = os.getenv('TELEGRAM_SESSION_NAME', 'account')
SESSION_WORKDIR = Path(os.getenv('TELEGRAM_SESSION_WORKDIR', str(Path(__file__).resolve().parent / 'runtime')))
API_ID = os.getenv('TELEGRAM_API_ID')
API_HASH = os.getenv('TELEGRAM_API_HASH')
CUSTODY_TELEGRAM_USER_ID = os.getenv('CUSTODY_TELEGRAM_USER_ID', '').strip()
CUSTODY_RECONCILE_INTERVAL_SECONDS = int(os.getenv('CUSTODY_RECONCILE_INTERVAL_SECONDS', '3600'))
GIFT_CUSTODY_SCAN_TIMEOUT_SECONDS = max(1, min(300, int(os.getenv('GIFT_CUSTODY_SCAN_TIMEOUT_SECONDS', '60'))))

GIFT_WITHDRAW_MAX_STARS = max(0, int(os.getenv('GIFT_WITHDRAW_MAX_STARS', '25')))


def renamed_settings_in_use(environ=os.environ):
    return [f'{old} was renamed to {new}' for old, new in RENAMED_SETTINGS.items() if old in environ]
