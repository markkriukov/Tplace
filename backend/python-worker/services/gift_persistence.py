from contextlib import nullcontext
from sqlalchemy import select, text as sql_text, or_, func, tuple_
from db import (
    Background, Collection, CollectionBackground, CollectionSymbol, Gift, GiftModel, GiftText, GiftSymbol, SessionLocal,
)
from db.advisory_locks import GIFT_PERSISTENCE_LOCK
from mappers.telegram_gift import normalize_collection_key, prepare_gift
from repositories.gifts import (
    upsert_user,
    get_or_create_text,
    save_gifts_and_ownerships,
)


def _normalized(column):
    return func.regexp_replace(func.lower(column), '[^a-z0-9]+', '', 'g')


def _load_catalog(session, gifts):
    regular_ids = {gift['regular_gift_id'] for gift in gifts if gift['regular_gift_id'] is not None}
    keys = set().union(*(gift['collection_keys'] for gift in gifts if gift['regular_gift_id'] is None))
    collections = session.execute(select(
        Collection.pk_collection_id, Collection.collection_regular_id, Collection.short_name, Collection.display_name,
    ).where(or_(
        Collection.collection_regular_id.in_(regular_ids),
        _normalized(Collection.short_name).in_(keys),
        _normalized(Collection.display_name).in_(keys),
    ))).all()
    by_regular_id, by_key = {}, {}
    for row in collections:
        if row.collection_regular_id is not None:
            by_regular_id[int(row.collection_regular_id)] = row.pk_collection_id
        for key in {normalize_collection_key(row.short_name), normalize_collection_key(row.display_name)} & keys:
            by_key.setdefault(key, set()).add(row.pk_collection_id)
    collection_ids = [row.pk_collection_id for row in collections]
    backdrop_names = {gift['backdrop'][0] for gift in gifts}
    backdrop_ids = {int(gift['backdrop'][1]) for gift in gifts if gift['backdrop'][1] is not None}
    backgrounds = session.execute(select(Background.pk_background_id, Background.name, Background.background_id).where(
        or_(Background.name.in_(backdrop_names), Background.background_id.in_(backdrop_ids)))).all()
    return {
        'by_regular_id': by_regular_id,
        'by_key': by_key,
        'models': {(row.fk_collection_id, row.name): row.pk_model_id for row in session.execute(
            select(GiftModel.pk_model_id, GiftModel.fk_collection_id, GiftModel.name).where(
                GiftModel.fk_collection_id.in_(collection_ids), GiftModel.name.in_({gift['model'] for gift in gifts})))},
        'backgrounds_by_name': {row.name: row.pk_background_id for row in backgrounds},
        'backgrounds_by_id': {int(row.background_id): row.pk_background_id
                              for row in backgrounds if row.background_id is not None},
        'symbols': {row.name: row.pk_symbol_id for row in session.execute(
            select(GiftSymbol.pk_symbol_id, GiftSymbol.name).where(GiftSymbol.name.in_({gift['symbol'] for gift in gifts})))},
        'background_links': set(session.execute(select(
            CollectionBackground.fk_collection_id, CollectionBackground.fk_background_id,
        ).where(CollectionBackground.fk_collection_id.in_(collection_ids))).tuples()),
        'symbol_links': set(session.execute(select(
            CollectionSymbol.fk_collection_id, CollectionSymbol.fk_symbol_id,
        ).where(CollectionSymbol.fk_collection_id.in_(collection_ids))).tuples()),
    }


def _resolve_attributes(catalog, gift):
    """Catalog IDs of the gift's attributes, or the name of the first missing one."""
    # Trust Telegram's regular gift ID when present; names only identify older payloads.
    if gift['regular_gift_id'] is not None:
        collection = catalog['by_regular_id'].get(gift['regular_gift_id'])
        if collection is None:
            return None, 'collection'
    else:
        matches = set().union(*(catalog['by_key'].get(key, set()) for key in gift['collection_keys']))
        if len(matches) != 1:
            return None, 'collection'
        collection = next(iter(matches))
    model = catalog['models'].get((collection, gift['model']))
    if model is None:
        return None, f"model {gift['model']!r}"
    backdrop_name, backdrop_id = gift['backdrop']
    background = catalog['backgrounds_by_name'].get(backdrop_name)
    if background is None and backdrop_id is not None:
        background = catalog['backgrounds_by_id'].get(int(backdrop_id))
    if background is None or (collection, background) not in catalog['background_links']:
        return None, f'backdrop {backdrop_name!r}'
    symbol = catalog['symbols'].get(gift['symbol'])
    if symbol is None or (collection, symbol) not in catalog['symbol_links']:
        return None, f"symbol {gift['symbol']!r}"
    return {'fk_collection_id': collection, 'fk_model_id': model,
            'fk_background_id': background, 'fk_symbol_id': symbol}, None


def save_gift_batch(user_display_name, gifts, *, owner_id, session=None, custodian_id=None):
    """Saves gifts whose attributes are in the catalog; returns (added, missing).

    Only the Changes API sync fills the catalog. A gift whose collection, model,
    backdrop or symbol is not there yet is skipped and reported in missing as
    (telegram_gift_id, attribute), so the caller can retry it later.
    """
    with (nullcontext(session) if session is not None else SessionLocal.begin()) as session:
        # Serialize persistence with deposits and imports; network access is outside this transaction.
        session.execute(sql_text('SELECT pg_advisory_xact_lock(:key)'), {'key': GIFT_PERSISTENCE_LOCK})
        # Only unseen gifts are added; existing attributes, market ownership and
        # evidence of physical custody are never changed here.
        existing = set(session.scalars(select(Gift.telegram_gift_id).where(Gift.telegram_gift_id.in_([int(gift.id) for gift in gifts]))))
        gifts = [gift for gift in gifts if int(gift.id) not in existing]
        prepared_gifts = [prepare_gift(gift, user_display_name) for gift in gifts]
        if not prepared_gifts:
            return 0, []
        catalog = _load_catalog(session, prepared_gifts)
        resolved, missing = [], []
        for gift in prepared_gifts:
            attributes, absent = _resolve_attributes(catalog, gift)
            if absent is None:
                resolved.append((gift, attributes))
            else:
                missing.append((gift['telegram_gift_id'], absent))
        text_keys = [gift['text'] for gift, _ in resolved]
        existing_texts = session.scalars(select(GiftText).where(
            tuple_(GiftText.from_name, GiftText.to_name).in_({key[:2] for key in text_keys}),
        )) if text_keys else []
        text_cache = {(item.from_name, item.to_name, item.text): item for item in existing_texts}
        gift_rows = {}
        for gift, attributes in resolved:
            text = text_cache.get(gift['text'])
            if text is None:
                text = text_cache[gift['text']] = get_or_create_text(session, *gift['text'])
            gift_rows[gift['telegram_gift_id']] = {'telegram_gift_id': gift['telegram_gift_id'], 'name': gift['name'], **attributes,
                                     'fk_text_id': int(text.pk_text_id)}
        added = save_gifts_and_ownerships(session, owner_id, list(gift_rows.values()), custodian_id=custodian_id)
        return added, missing


def complete_custody_snapshot(telegram_user, run_id, seen_ids):
    # Publish absence only after a successful full scan AND client shutdown.
    # An older concurrent scan must never overwrite a newer completed snapshot.
    with SessionLocal.begin() as session:
        session.execute(sql_text('SELECT pg_advisory_xact_lock(:key)'), {'key': GIFT_PERSISTENCE_LOCK})
        user = upsert_user(session, telegram_user)
        previous = session.scalar(sql_text(
            'SELECT completed_run FROM gift_custody_snapshots WHERE fk_user_id=:user'
        ), {'user': user.pk_user_id})
        if previous is not None and previous >= run_id:
            return
        session.execute(sql_text('''
            UPDATE gift_custody_observations o SET is_present = g.telegram_gift_id = ANY(CAST(:seen AS bigint[]))
            FROM gifts g WHERE g.pk_gift_id=o.fk_gift_id AND o.fk_custodian_user_id=:user
              AND o.is_present IS DISTINCT FROM (g.telegram_gift_id = ANY(CAST(:seen AS bigint[])))
        '''), {'seen': seen_ids, 'user': user.pk_user_id})
        session.execute(sql_text('''
            INSERT INTO gift_custody_snapshots(fk_user_id, completed_run) VALUES (:user, :run)
            ON CONFLICT (fk_user_id) DO UPDATE SET completed_run=EXCLUDED.completed_run, completed_at=now()
        '''), {'user': user.pk_user_id, 'run': run_id})
