import time
import unittest
from types import SimpleNamespace

from database_fixture import requires_database
from mappers.telegram_gift import is_regular_gift, prepare_gift


def gift_fixture(identifier, prefix='Catalog', **overrides):
    values = {
        'id': identifier, 'name': f'{prefix}{identifier}-1', 'type': 'UPGRADED', 'regular_gift_id': identifier + 1000,
        'model': SimpleNamespace(name=f'{prefix} model'),
        'symbol': SimpleNamespace(name=f'{prefix} symbol {identifier}'),
        'backdrop': SimpleNamespace(backdrop_id=identifier + 2000, name=f'{prefix} backdrop {identifier}'),
    }
    return SimpleNamespace(**{**values, **overrides})


class GiftMappingTests(unittest.TestCase):
    def test_prepared_gift_carries_only_catalog_lookup_keys(self):
        gift = SimpleNamespace(
            id=7, slug='LibertyFigure-178814', title='Liberty Figure', regular_gift_id=55,
            model=SimpleNamespace(name=' Statue ', rarity=15),
            symbol=SimpleNamespace(name='Torch', rarity=20),
            backdrop=SimpleNamespace(name='Gold', backdrop_id=9, rarity=30),
        )
        prepared = prepare_gift(gift, 'Owner')
        self.assertEqual(prepared['name'], 'LibertyFigure-178814')
        self.assertEqual(prepared['regular_gift_id'], 55)
        self.assertEqual(prepared['collection_keys'], {'libertyfigure'})
        self.assertEqual((prepared['model'], prepared['symbol'], prepared['backdrop']), ('Statue', 'Torch', ('Gold', 9)))
        # Missing attributes stay missing instead of becoming synthetic catalog names.
        bare = prepare_gift(SimpleNamespace(id=8), 'Owner')
        self.assertEqual((bare['name'], bare['model'], bare['symbol'], bare['backdrop']), ('Gift 8', None, None, (None, None)))
        self.assertEqual(bare['collection_keys'], set())

    def test_regular_gifts_are_excluded(self):
        self.assertTrue(is_regular_gift(SimpleNamespace(type='REGULAR')))
        self.assertFalse(is_regular_gift(SimpleNamespace(type='UPGRADED')))


@requires_database
class GiftCatalogLookupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from services import gift_persistence
        from db import init_database
        init_database()
        cls.persistence = gift_persistence

    def owner(self, identifier, name='Owner'):
        from db import SessionLocal
        from repositories.gifts import upsert_user
        with SessionLocal.begin() as session:
            return int(upsert_user(session, SimpleNamespace(
                id=identifier, first_name=name, username=f'{name.lower()}_{identifier}')).pk_user_id)

    def catalog_counts(self):
        from sqlalchemy import text
        from db import SessionLocal
        with SessionLocal() as session:
            return session.execute(text('''SELECT (SELECT count(*) FROM collections), (SELECT count(*) FROM models),
                (SELECT count(*) FROM backgrounds), (SELECT count(*) FROM symbols),
                (SELECT count(*) FROM collection_backgrounds), (SELECT count(*) FROM collection_symbols)''')).one()

    def test_attributes_resolve_only_from_the_catalog(self):
        from sqlalchemy import select, event
        from db import SessionLocal, Gift, GiftText
        from db.session import engine
        from catalog_fixture import seed_catalog
        identifier = time.time_ns() // 1000
        owner = self.owner(identifier)
        by_regular_id = gift_fixture(identifier + 1, title='Some other name')
        collection = seed_catalog(by_regular_id)
        # Without regular_gift_id the slug prefix names the collection.
        by_name = gift_fixture(identifier + 2, regular_gift_id=None)
        seed_catalog(by_name, collection=f'Catalog {identifier + 2}')
        unknown_model = gift_fixture(identifier + 3, regular_gift_id=by_regular_id.regular_gift_id,
                                     model=SimpleNamespace(name='Not in catalog'))
        unlinked_symbol = gift_fixture(identifier + 4, regular_gift_id=by_regular_id.regular_gift_id,
                                       model=by_regular_id.model, backdrop=by_regular_id.backdrop,
                                       symbol=by_name.symbol)
        unknown_collection = gift_fixture(identifier + 5, regular_gift_id=None, name=f'Nowhere{identifier}-1')
        no_attributes = SimpleNamespace(id=identifier + 6, type='UPGRADED', regular_gift_id=by_regular_id.regular_gift_id)
        before = self.catalog_counts()
        statements = []

        def record_sql(_connection, _cursor, statement, _params, _context, _many):
            statements.append(statement)

        event.listen(engine, 'before_cursor_execute', record_sql)
        try:
            added, missing = self.persistence.save_gift_batch(
                'Owner', [by_regular_id, by_name, unknown_model, unlinked_symbol, unknown_collection, no_attributes],
                owner_id=owner)
        finally:
            event.remove(engine, 'before_cursor_execute', record_sql)
        self.assertEqual(added, 2)
        self.assertEqual(dict(missing), {
            unknown_model.id: "model 'Not in catalog'",
            unlinked_symbol.id: f"symbol '{by_name.symbol.name}'",
            unknown_collection.id: 'collection',
            no_attributes.id: 'model None',
        })
        self.assertEqual(self.catalog_counts(), before, 'The worker must not write the catalog')
        for table in ['collections', 'models', 'backgrounds', 'symbols', 'collection_backgrounds', 'collection_symbols']:
            reads = [sql for sql in statements if f'FROM {table}' in sql]
            self.assertEqual(len(reads), 1, f'One {table} lookup per batch')
            self.assertIn('WHERE', reads[0], f'Unbounded {table} preload')
        with SessionLocal() as session:
            saved = {gift.telegram_gift_id: gift for gift in session.scalars(select(Gift).where(Gift.telegram_gift_id.in_([by_regular_id.id, by_name.id])))}
            self.assertEqual(saved[by_regular_id.id].fk_collection_id, collection)
            self.assertNotEqual(saved[by_name.id].fk_collection_id, collection)
            text = session.get(GiftText, saved[by_name.id].fk_text_id)
            self.assertEqual((text.from_name, text.to_name), ('Unknown Sender', 'Owner'))

    def test_ambiguous_collection_name_is_not_guessed(self):
        from catalog_fixture import seed_catalog
        identifier = time.time_ns() // 1000
        gift = gift_fixture(identifier, regular_gift_id=None)
        seed_catalog(gift, collection=f'catalog-{identifier}')
        seed_catalog(gift, collection=f'Catalog {identifier}')
        self.assertEqual(self.persistence.save_gift_batch('Owner', [gift], owner_id=self.owner(identifier)),
                         (0, [(gift.id, 'collection')]))

    def test_only_complete_newer_snapshots_change_availability(self):
        from sqlalchemy import text
        from db import SessionLocal
        from catalog_fixture import seed_catalog
        identifier = time.time_ns() // 1000
        custodian = SimpleNamespace(id=identifier, first_name='Snapshot', username=f'snapshot_{identifier}')
        keeper = self.owner(custodian.id, 'Snapshot')
        gift = gift_fixture(identifier + 1, 'Snapshot')
        seed_catalog(gift)

        def present():
            with SessionLocal() as session:
                return session.scalar(text('''
                    SELECT o.is_present FROM gift_custody_observations o
                    JOIN gifts g ON g.pk_gift_id=o.fk_gift_id WHERE g.telegram_gift_id=:gift
                '''), {'gift': gift.id})

        def run_id():
            with SessionLocal.begin() as session:
                return session.scalar(text("SELECT nextval('gift_custody_sync_run_seq')"))

        self.assertEqual(self.persistence.save_gift_batch('Snapshot', [gift], owner_id=keeper, custodian_id=keeper), (1, []))
        self.persistence.complete_custody_snapshot(custodian, run_id(), [gift.id])
        self.assertTrue(present())
        self.persistence.complete_custody_snapshot(custodian, run_id(), [])
        self.assertFalse(present(), 'A completed empty scan must publish absence')
        self.persistence.complete_custody_snapshot(custodian, 0, [gift.id])
        self.assertFalse(present(), 'An older completed scan cannot replace a newer one')
        self.persistence.complete_custody_snapshot(custodian, run_id(), [gift.id])
        self.assertTrue(present())

    def test_concurrent_saves_do_not_duplicate_gifts(self):
        from concurrent.futures import ThreadPoolExecutor
        from catalog_fixture import seed_catalog
        identifier = time.time_ns() // 1000
        owner = self.owner(identifier, 'Concurrent')
        gift = gift_fixture(identifier + 1, 'Concurrent')
        seed_catalog(gift)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.persistence.save_gift_batch, 'Concurrent', [gift], owner_id=owner, custodian_id=owner)
                       for _ in range(2)]
            self.assertEqual(sorted(future.result()[0] for future in futures), [0, 1])


if __name__ == '__main__':
    unittest.main()
