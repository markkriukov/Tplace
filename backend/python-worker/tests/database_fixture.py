"""Points the worker at the disposable test database.

Import before worker modules: db.session reads DATABASE_URL on import and
otherwise falls back to the local working database.
"""

import os
import unittest
from urllib.parse import urlparse

TEST_DATABASE_URL = os.getenv('TEST_DATABASE_URL')

if TEST_DATABASE_URL:
    if not urlparse(TEST_DATABASE_URL).path.endswith('_test'):
        raise ValueError('TEST_DATABASE_URL must name a dedicated database ending in _test')
    os.environ['DATABASE_URL'] = TEST_DATABASE_URL.replace('postgresql://', 'postgresql+psycopg://', 1)
elif os.getenv('REQUIRE_TEST_DATABASE') == '1':
    # Full runs must not pass by silently skipping the database suites.
    raise RuntimeError('REQUIRE_TEST_DATABASE=1 needs TEST_DATABASE_URL '
                       '(docker compose -f docker-compose.test.yml up -d --wait)')

requires_database = unittest.skipUnless(TEST_DATABASE_URL, 'Set TEST_DATABASE_URL to a migrated disposable database')
