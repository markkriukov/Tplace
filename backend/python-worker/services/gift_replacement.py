"""Remove a test gift atomically with registration of its real deposit."""
import json

from sqlalchemy import text


def remove_test_gift(session, gift):
    # The caller holds the persistence advisory lock and the gift row lock.
    # Match marketplace lock order: gift, offers, all wallets by user ID.
    if not gift.is_test_import:
        raise ValueError('Only test gifts can be replaced')
    offers = session.execute(text('''SELECT * FROM offers WHERE fk_gift_id=:gift
        AND status='pending' ORDER BY pk_offer_id FOR UPDATE'''),
        {'gift': gift.pk_gift_id}).mappings().all()
    wallets = {}
    for user_id in sorted({offer['fk_buyer_user_id'] for offer in offers}):
        wallets[user_id] = dict(session.execute(text('''SELECT * FROM wallet_balances
            WHERE fk_user_id=:user FOR UPDATE'''), {'user': user_id}).mappings().one())
    for offer in offers:
        wallet = wallets[offer['fk_buyer_user_id']]
        amount = offer['escrow_locked_nano']
        if wallet['currency_code'] != offer['currency_code'] or wallet['locked_nano'] < amount:
            raise ValueError('Test gift offer reservation is inconsistent')
        if amount:
            available_before = wallet['available_nano']
            # Releasing escrow moves funds within the wallet: its total is unchanged.
            total = wallet['available_nano'] + wallet['locked_nano']
            wallet['available_nano'] += amount
            wallet['locked_nano'] -= amount
            session.execute(text('''UPDATE wallet_balances SET available_nano=:available,
                locked_nano=:locked,updated_at=now() WHERE fk_user_id=:user'''),
                {'available': wallet['available_nano'], 'locked': wallet['locked_nano'],
                 'user': offer['fk_buyer_user_id']})
            # The offer names the escrow; the rest of the split follows from the
            # balances and the amount.
            session.execute(text('''INSERT INTO wallet_transactions
                (fk_user_id,tx_kind,direction,status,amount_nano,balance_before_nano,
                 balance_after_nano,fk_gift_id,fk_offer_id,note,meta,finalized_at)
                VALUES (:user,'offer_escrow_release','credit','completed',:amount,:total,
                        :total,:gift,:offer,'Test gift replaced by real deposit',CAST(:meta AS jsonb),now())'''),
                {'user': offer['fk_buyer_user_id'], 'amount': amount, 'total': total,
                 'gift': gift.pk_gift_id, 'offer': offer['pk_offer_id'], 'meta': json.dumps({
                     'release_reason': 'test_gift_replaced', 'available_before_nano': available_before,
                 })})
        session.execute(text('''UPDATE offers SET status='canceled',escrow_locked_nano=0,
            resolved_at=now(),updated_at=now() WHERE pk_offer_id=:id'''), {'id': offer['pk_offer_id']})
    session.execute(text('''UPDATE gift_listings SET status='canceled',closed_at=now(),
        closed_reason='test_gift_replaced',updated_at=now()
        WHERE fk_gift_id=:gift AND status='active' '''), {'gift': gift.pk_gift_id})
    session.execute(text('DELETE FROM gift_custody_observations WHERE fk_gift_id=:gift'),
                    {'gift': gift.pk_gift_id})
    # Listings, offers and ledger rows keep their history with a NULL gift link.
    # Fee entries reference those retained rows and remain immutable.
    session.delete(gift)
    session.flush()
