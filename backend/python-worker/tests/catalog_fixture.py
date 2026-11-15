"""Catalog rows the Changes API sync provides; the worker only reads them."""


def seed_catalog(gift, *, collection=None):
    """Creates the collection, model, backdrop, symbol and links named by a test gift."""
    from sqlalchemy import text
    from db import SessionLocal
    from mappers.telegram_gift import prepare_gift
    prepared = prepare_gift(gift, '')
    short_name = collection or f"test-{prepared['regular_gift_id']}"
    backdrop_name, backdrop_id = prepared['backdrop']
    with SessionLocal.begin() as session:
        def upsert(sql, **values):
            return session.scalar(text(sql), values)
        collection_id = upsert('''INSERT INTO collections(short_name, display_name, collection_regular_id)
            VALUES (:short, :short, :regular)
            ON CONFLICT (short_name) DO UPDATE SET short_name=EXCLUDED.short_name RETURNING pk_collection_id''',
            short=short_name, regular=prepared['regular_gift_id'])
        upsert('''INSERT INTO models(fk_collection_id, name) VALUES (:collection, :name)
            ON CONFLICT (fk_collection_id, name) DO UPDATE SET name=EXCLUDED.name RETURNING pk_model_id''',
            collection=collection_id, name=prepared['model'])
        background_id = upsert('''INSERT INTO backgrounds(name, background_id) VALUES (:name, :external)
            ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING pk_background_id''',
            name=backdrop_name, external=backdrop_id)
        symbol_id = upsert('''INSERT INTO symbols(name) VALUES (:name)
            ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING pk_symbol_id''', name=prepared['symbol'])
        session.execute(text('''INSERT INTO collection_backgrounds(fk_collection_id, fk_background_id)
            VALUES (:collection, :background) ON CONFLICT DO NOTHING'''),
            {'collection': collection_id, 'background': background_id})
        session.execute(text('''INSERT INTO collection_symbols(fk_collection_id, fk_symbol_id)
            VALUES (:collection, :symbol) ON CONFLICT DO NOTHING'''), {'collection': collection_id, 'symbol': symbol_id})
        return collection_id
