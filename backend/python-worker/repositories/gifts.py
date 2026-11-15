from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from typing import Any
from db import Gift, GiftText, User, Ownership
from mappers.telegram_gift import first_attribute


def upsert_user(session: Session, telegram_user: Any) -> User:
    tg_user_id = int(telegram_user.id)

    username = first_attribute(telegram_user, 'username', default=None)
    first_name = first_attribute(telegram_user, 'first_name', default=None)

    statement = insert(User).values(telegram_id=tg_user_id, username=username, first_name=first_name)
    statement = statement.on_conflict_do_update(
        index_elements=[User.telegram_id],
        set_={'username': statement.excluded.username, 'first_name': statement.excluded.first_name},
    ).returning(User)
    # Refresh existing identity-map objects while preserving their is_admin flag.
    return session.scalar(statement, execution_options={'populate_existing': True})


def get_or_create_text(session: Session, from_name: str, to_name: str, text_value: str | None) -> GiftText:
    obj = session.scalar(
        select(GiftText).where(
            GiftText.from_name == from_name,
            GiftText.to_name == to_name,
            GiftText.text == text_value,
        )
    )
    if obj is None:
        obj = GiftText(from_name=from_name, to_name=to_name, text=text_value)
        session.add(obj)
        session.flush()
    return obj


def save_gifts_and_ownerships(session, user_id, rows, *, custodian_id=None):
    """Inserts new gifts owned by user_id; custodian_id records physical custody.

    Without a custodian the gifts are test imports, unavailable for trading.
    """
    if not rows:
        return 0
    gift_ids = list(session.scalars(insert(Gift).returning(Gift.pk_gift_id),
                                    [{**row, 'is_test_import': custodian_id is None} for row in rows]))
    if custodian_id is not None:
        session.execute(text("""
        INSERT INTO gift_custody_observations (fk_gift_id, fk_custodian_user_id) VALUES (:gift, :user)
        """), [{'gift': gift_id, 'user': custodian_id} for gift_id in gift_ids])
    session.execute(insert(Ownership), [{'fk_user_id': user_id, 'fk_gift_id': gift_id} for gift_id in gift_ids])
    return len(gift_ids)
