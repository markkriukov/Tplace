import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker


DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql+psycopg://tplace:tplace@127.0.0.1:5432/tplace')
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_database() -> None:
    """Check readiness; only the Node migration command changes the shared schema.

    The worker image has no migration files to compare checksums with (Node does
    that), so a column of the current schema tells it apart from an older one.
    """
    with engine.connect() as connection:
        version = connection.scalar(text("""SELECT name FROM schema_migrations
            WHERE name = '001_initial.sql'
              AND current_setting('server_version_num')::integer >= 180000
              AND EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='gifts'
                  AND column_name='telegram_gift_id' AND data_type='bigint')"""))
        if version is None:
            raise RuntimeError('Database migrations are required: run npm run db:migrate in backend/node')
