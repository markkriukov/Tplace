"""Load the shared local environment before importing worker configuration."""

import os
from pathlib import Path

from dotenv import load_dotenv


def load_project_environment(env_file=None):
    database_url = os.environ.get('DATABASE_URL')
    if env_file is None:
        env_file = Path(__file__).resolve().parent.parent.parent / '.env'
    load_dotenv(env_file, override=False)
    if database_url is None and os.getenv('PYTHON_DATABASE_URL'):
        os.environ['DATABASE_URL'] = os.environ['PYTHON_DATABASE_URL']
