from sqlalchemy import (
    BigInteger,
    Integer,
    Boolean,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = 'users'

    pk_user_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, unique=True, server_default=text('uuidv7()'))
    telegram_id: Mapped[int] = mapped_column(BigInteger, nullable=False, unique=True)
    username: Mapped[str | None] = mapped_column(Text, nullable=True)
    first_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('FALSE'))
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))


class Collection(Base):
    __tablename__ = 'collections'

    pk_collection_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    short_name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    collection_regular_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    photo_url: Mapped[str | None] = mapped_column(Text, nullable=True)


class GiftModel(Base):
    __tablename__ = 'models'
    __table_args__ = (
        UniqueConstraint('fk_collection_id', 'name', name='uniq_model_collection_name'),
        UniqueConstraint('pk_model_id', 'fk_collection_id', name='uniq_model_id_collection'),
    )

    pk_model_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fk_collection_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey('collections.pk_collection_id', ondelete='CASCADE', name='fk_model_collection'),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    rarity: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)


class Background(Base):
    __tablename__ = 'backgrounds'

    pk_background_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    background_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, unique=True)
    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    center_color: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    edge_color: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    pattern_color: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    text_color: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class GiftSymbol(Base):
    __tablename__ = 'symbols'

    pk_symbol_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)


class CollectionBackground(Base):
    __tablename__ = 'collection_backgrounds'
    __table_args__ = (UniqueConstraint('fk_collection_id', 'fk_background_id', name='uniq_collection_background'),)

    pk_collection_background_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fk_collection_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey('collections.pk_collection_id', ondelete='CASCADE', name='fk_collection_background_collection'),
        nullable=False,
    )
    fk_background_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey('backgrounds.pk_background_id', ondelete='CASCADE', name='fk_collection_background_background'),
        nullable=False,
    )
    rarity: Mapped[str | None] = mapped_column(Text, nullable=True)


class CollectionSymbol(Base):
    __tablename__ = 'collection_symbols'
    __table_args__ = (UniqueConstraint('fk_collection_id', 'fk_symbol_id', name='uniq_collection_symbol'),)

    pk_collection_symbol_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fk_collection_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey('collections.pk_collection_id', ondelete='CASCADE', name='fk_collection_symbol_collection'),
        nullable=False,
    )
    fk_symbol_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey('symbols.pk_symbol_id', ondelete='CASCADE', name='fk_collection_symbol_symbol'),
        nullable=False,
    )
    rarity: Mapped[str | None] = mapped_column(Text, nullable=True)


class GiftText(Base):
    __tablename__ = 'gift_texts'

    pk_text_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    from_name: Mapped[str] = mapped_column(Text, nullable=False)
    to_name: Mapped[str] = mapped_column(Text, nullable=False)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)


class Gift(Base):
    __tablename__ = 'gifts'
    # Model, background and symbol must belong to the gift's collection.
    __table_args__ = (
        ForeignKeyConstraint(
            ['fk_model_id', 'fk_collection_id'], ['models.pk_model_id', 'models.fk_collection_id'],
            ondelete='RESTRICT', name='fk_gift_model_in_collection',
        ),
        ForeignKeyConstraint(
            ['fk_collection_id', 'fk_background_id'],
            ['collection_backgrounds.fk_collection_id', 'collection_backgrounds.fk_background_id'],
            ondelete='RESTRICT', name='fk_gift_background_in_collection',
        ),
        ForeignKeyConstraint(
            ['fk_collection_id', 'fk_symbol_id'],
            ['collection_symbols.fk_collection_id', 'collection_symbols.fk_symbol_id'],
            ondelete='RESTRICT', name='fk_gift_symbol_in_collection',
        ),
    )

    pk_gift_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, unique=True, server_default=text('uuidv7()'))
    is_test_import: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('FALSE'))
    telegram_gift_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)

    fk_collection_id: Mapped[int] = mapped_column(Integer, nullable=False)
    fk_model_id: Mapped[int] = mapped_column(Integer, nullable=False)
    fk_background_id: Mapped[int] = mapped_column(Integer, nullable=False)
    fk_symbol_id: Mapped[int] = mapped_column(Integer, nullable=False)
    fk_text_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey('gift_texts.pk_text_id', ondelete='SET NULL', name='fk_gift_text'),
        nullable=True,
    )


class Ownership(Base):
    __tablename__ = 'ownerships'
    __table_args__ = (UniqueConstraint('fk_user_id', 'fk_gift_id', name='uniq_ownership_user_gift'),)

    pk_ownership_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    fk_user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey('users.pk_user_id', ondelete='CASCADE', name='fk_ownership_user'),
        nullable=False,
    )
    fk_gift_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey('gifts.pk_gift_id', ondelete='CASCADE', name='fk_ownership_gift'),
        nullable=False,
    )

    acquired_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=text('CURRENT_TIMESTAMP'), nullable=False)
