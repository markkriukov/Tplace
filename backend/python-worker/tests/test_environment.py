import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from environment import load_project_environment


class SharedEnvironmentTests(unittest.TestCase):
    def test_loads_shared_settings_and_maps_the_python_database_url(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / '.env'
            env_file.write_text(
                'DATABASE_URL=postgresql://node@localhost/node\n'
                'PYTHON_DATABASE_URL=postgresql+psycopg://worker@localhost/worker\n'
                'TELEGRAM_API_HASH="synthetic value with spaces"\n', encoding='utf-8')
            with patch.dict(os.environ, {}, clear=True):
                load_project_environment(env_file)
                self.assertEqual(os.environ['DATABASE_URL'], 'postgresql+psycopg://worker@localhost/worker')
                self.assertEqual(os.environ['TELEGRAM_API_HASH'], 'synthetic value with spaces')

    def test_preserves_container_and_shell_overrides(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / '.env'
            env_file.write_text(
                'DATABASE_URL=postgresql://local@localhost/local\n'
                'PYTHON_DATABASE_URL=postgresql+psycopg://local@localhost/local\n'
                'TELEGRAM_API_HASH=local\n', encoding='utf-8')
            overrides = {'DATABASE_URL': 'postgresql+psycopg://container@postgres/container',
                         'TELEGRAM_API_HASH': 'container'}
            with patch.dict(os.environ, overrides, clear=True):
                load_project_environment(env_file)
                self.assertEqual(os.environ['DATABASE_URL'], overrides['DATABASE_URL'])
                self.assertEqual(os.environ['TELEGRAM_API_HASH'], overrides['TELEGRAM_API_HASH'])

    def test_missing_local_file_leaves_the_environment_unchanged(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            load_project_environment(Path(directory) / '.env')
            self.assertEqual(dict(os.environ), {})
