import { APP_CURRENCY } from '../config.js'
import { DataTypes } from 'sequelize'
import { sequelize } from './sequelize.js'

const serialKey = () => ({ type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true })
const publicId = () => ({ type: DataTypes.UUID, allowNull: false, unique: true, defaultValue: sequelize.literal('uuidv7()') })
const timestamp = () => ({ type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') })
const currency = () => ({ type: DataTypes.TEXT, allowNull: false, defaultValue: APP_CURRENCY })

export const User = sequelize.define(
  'User',
  {
    pk_user_id: serialKey(),
    public_id: publicId(),
    telegram_id: { type: DataTypes.BIGINT, allowNull: false, unique: true },
    username: { type: DataTypes.TEXT, allowNull: true },
    first_name: { type: DataTypes.TEXT, allowNull: true },
    is_admin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    token_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  { tableName: 'users', timestamps: false }
)

export const Collection = sequelize.define(
  'Collection',
  {
    pk_collection_id: serialKey(),
    short_name: { type: DataTypes.TEXT, allowNull: false, unique: true },
    display_name: { type: DataTypes.TEXT, allowNull: false },
    collection_regular_id: { type: DataTypes.BIGINT, allowNull: true },
    photo_url: { type: DataTypes.TEXT, allowNull: true },
  },
  { tableName: 'collections', timestamps: false, indexes: [{ fields: ['collection_regular_id'] }] }
)

export const GiftModel = sequelize.define(
  'GiftModel',
  {
    pk_model_id: serialKey(),
    fk_collection_id: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.TEXT, allowNull: false },
    rarity: { type: DataTypes.TEXT, allowNull: true },
    url: { type: DataTypes.TEXT, allowNull: true },
  },
  { tableName: 'models', timestamps: false, indexes: [{ unique: true, fields: ['fk_collection_id', 'name'] }] }
)

export const Background = sequelize.define(
  'Background',
  {
    pk_background_id: serialKey(),
    background_id: { type: DataTypes.BIGINT, allowNull: true, unique: true },
    name: { type: DataTypes.TEXT, allowNull: false, unique: true },
    center_color: { type: DataTypes.BIGINT, allowNull: true },
    edge_color: { type: DataTypes.BIGINT, allowNull: true },
    pattern_color: { type: DataTypes.BIGINT, allowNull: true },
    text_color: { type: DataTypes.BIGINT, allowNull: true },
  },
  { tableName: 'backgrounds', timestamps: false }
)

export const GiftSymbol = sequelize.define(
  'GiftSymbol',
  {
    pk_symbol_id: serialKey(),
    name: { type: DataTypes.TEXT, allowNull: false, unique: true },
    url: { type: DataTypes.TEXT, allowNull: true },
  },
  { tableName: 'symbols', timestamps: false }
)

export const CollectionBackground = sequelize.define(
  'CollectionBackground',
  {
    pk_collection_background_id: serialKey(),
    fk_collection_id: { type: DataTypes.INTEGER, allowNull: false },
    fk_background_id: { type: DataTypes.INTEGER, allowNull: false },
    rarity: { type: DataTypes.TEXT, allowNull: true },
  },
  { tableName: 'collection_backgrounds', timestamps: false, indexes: [{ unique: true, fields: ['fk_collection_id', 'fk_background_id'] }] }
)

export const CollectionSymbol = sequelize.define(
  'CollectionSymbol',
  {
    pk_collection_symbol_id: serialKey(),
    fk_collection_id: { type: DataTypes.INTEGER, allowNull: false },
    fk_symbol_id: { type: DataTypes.INTEGER, allowNull: false },
    rarity: { type: DataTypes.TEXT, allowNull: true },
  },
  { tableName: 'collection_symbols', timestamps: false, indexes: [{ unique: true, fields: ['fk_collection_id', 'fk_symbol_id'] }] }
)

// Gift texts are written only by the Python worker; the API never reads them.
export const Gift = sequelize.define(
  'Gift',
  {
    pk_gift_id: serialKey(),
    public_id: publicId(),
    is_test_import: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    telegram_gift_id: { type: DataTypes.BIGINT, allowNull: false },
    name: { type: DataTypes.TEXT, allowNull: false },
    fk_collection_id: { type: DataTypes.INTEGER, allowNull: false },
    fk_model_id: { type: DataTypes.INTEGER, allowNull: false },
    fk_background_id: { type: DataTypes.INTEGER, allowNull: false },
    fk_symbol_id: { type: DataTypes.INTEGER, allowNull: false },
    fk_text_id: { type: DataTypes.INTEGER, allowNull: true },
  },
  { tableName: 'gifts', timestamps: false }
)

export const Ownership = sequelize.define(
  'Ownership',
  {
    pk_ownership_id: serialKey(),
    fk_user_id: { type: DataTypes.INTEGER, allowNull: false },
    fk_gift_id: { type: DataTypes.INTEGER, allowNull: false },
    acquired_at: timestamp(),
  },
  {
    tableName: 'ownerships',
    timestamps: false,
    indexes: [{ unique: true, fields: ['fk_user_id', 'fk_gift_id'] }, { fields: ['fk_gift_id'] }],
  }
)

export const GiftListing = sequelize.define(
  'GiftListing',
  {
    pk_gift_listing_id: serialKey(),
    public_id: publicId(),
    fk_gift_id: { type: DataTypes.INTEGER, allowNull: true },
    fk_seller_user_id: { type: DataTypes.INTEGER, allowNull: false },
    fk_buyer_user_id: { type: DataTypes.INTEGER, allowNull: true },
    currency_code: currency(),
    price_nano: { type: DataTypes.BIGINT, allowNull: false },
    status: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'active' },
    listed_at: timestamp(),
    closed_at: { type: DataTypes.DATE, allowNull: true },
    closed_reason: { type: DataTypes.TEXT, allowNull: true },
    created_at: timestamp(),
    updated_at: timestamp(),
  },
  {
    tableName: 'gift_listings',
    timestamps: false,
    indexes: [{ unique: true, fields: ['fk_gift_id'], where: { status: 'active' } }, { fields: ['fk_gift_id', 'status'] }],
  }
)

export const WalletBalance = sequelize.define(
  'WalletBalance',
  {
    pk_wallet_balance_id: serialKey(),
    fk_user_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    currency_code: currency(),
    available_nano: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    locked_nano: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    // available + locked: computed on read, never stored.
    total_nano: {
      type: DataTypes.VIRTUAL(DataTypes.BIGINT, ['available_nano', 'locked_nano']),
      get() {
        const available = this.getDataValue('available_nano')
        const locked = this.getDataValue('locked_nano')
        return available == null || locked == null ? null : (BigInt(available) + BigInt(locked)).toString()
      },
    },
    created_at: timestamp(),
    updated_at: timestamp(),
  },
  { tableName: 'wallet_balances', timestamps: false }
)

export const WalletTransaction = sequelize.define(
  'WalletTransaction',
  {
    pk_wallet_tx_id: serialKey(),
    public_id: publicId(),
    fk_user_id: { type: DataTypes.INTEGER, allowNull: false },
    tx_kind: { type: DataTypes.TEXT, allowNull: false },
    direction: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.TEXT, allowNull: false },
    amount_nano: { type: DataTypes.BIGINT, allowNull: false },
    fee_nano: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    balance_before_nano: { type: DataTypes.BIGINT, allowNull: true },
    balance_after_nano: { type: DataTypes.BIGINT, allowNull: true },
    fk_gift_id: { type: DataTypes.INTEGER, allowNull: true },
    fk_offer_id: { type: DataTypes.INTEGER, allowNull: true },
    fk_counterparty_user_id: { type: DataTypes.INTEGER, allowNull: true },
    idempotency_key: { type: DataTypes.TEXT, allowNull: true },
    external_ref: { type: DataTypes.TEXT, allowNull: true },
    note: { type: DataTypes.TEXT, allowNull: true },
    meta: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    created_at: timestamp(),
    finalized_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: 'wallet_transactions',
    timestamps: false,
    indexes: [{ fields: ['fk_user_id', 'pk_wallet_tx_id'] }, { fields: ['fk_gift_id'] }],
  }
)

export const Offer = sequelize.define(
  'Offer',
  {
    pk_offer_id: serialKey(),
    public_id: publicId(),
    fk_gift_id: { type: DataTypes.INTEGER, allowNull: true },
    fk_buyer_user_id: { type: DataTypes.INTEGER, allowNull: false },
    fk_seller_user_id: { type: DataTypes.INTEGER, allowNull: false },
    currency_code: currency(),
    amount_nano: { type: DataTypes.BIGINT, allowNull: false },
    escrow_locked_nano: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'pending' },
    expires_at: { type: DataTypes.DATE, allowNull: true },
    created_at: timestamp(),
    updated_at: timestamp(),
    resolved_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: 'offers',
    timestamps: false,
    indexes: [
      { fields: ['fk_seller_user_id', 'status', 'created_at'] },
      { fields: ['fk_buyer_user_id', 'status', 'created_at'] },
      { fields: ['fk_gift_id', 'status', 'created_at'] },
    ],
  }
)

export const MarketplaceFeeEntry = sequelize.define(
  'MarketplaceFeeEntry',
  {
    pk_marketplace_fee_id: serialKey(),
    fk_gift_listing_id: { type: DataTypes.INTEGER, allowNull: true, unique: true },
    fk_offer_id: { type: DataTypes.INTEGER, allowNull: true, unique: true },
    // Fees imported from the ledger of the earlier marketplace account.
    fk_legacy_wallet_tx_id: { type: DataTypes.INTEGER, allowNull: true, unique: true },
    fk_gift_withdrawal_id: { type: DataTypes.INTEGER, allowNull: true, unique: true },
    currency_code: currency(),
    amount_nano: { type: DataTypes.BIGINT, allowNull: false },
    created_at: timestamp(),
  },
  { tableName: 'marketplace_fee_entries', timestamps: false }
)

export const News = sequelize.define(
  'News',
  {
    pk_news_id: serialKey(),
    public_id: publicId(),
    title: { type: DataTypes.TEXT, allowNull: false },
    lead: { type: DataTypes.TEXT, allowNull: true },
    content: { type: DataTypes.TEXT, allowNull: false },
    image_url: { type: DataTypes.TEXT, allowNull: true },
    published_at: { type: DataTypes.DATE, allowNull: true },
    created_at: timestamp(),
    updated_at: timestamp(),
  },
  { tableName: 'news', timestamps: false, indexes: [{ fields: ['published_at', 'created_at'] }] }
)

export const TonPayment = sequelize.define(
  'TonPayment',
  {
    pk_payment_id: serialKey(),
    public_id: publicId(),
    fk_user_id: { type: DataTypes.INTEGER, allowNull: false },
    fk_wallet_tx_id: { type: DataTypes.INTEGER, allowNull: false },
    idempotency_key: { type: DataTypes.TEXT, allowNull: false },
    kind: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.TEXT, allowNull: false },
    network: { type: DataTypes.TEXT, allowNull: false },
    treasury_address: { type: DataTypes.TEXT, allowNull: false },
    wallet_address: { type: DataTypes.TEXT, allowNull: false },
    amount_nano: { type: DataTypes.BIGINT, allowNull: false },
    fee_nano: { type: DataTypes.BIGINT, allowNull: false },
    memo: { type: DataTypes.TEXT, allowNull: false },
    valid_until: { type: DataTypes.BIGINT, allowNull: false },
    signed_boc: DataTypes.TEXT,
    seqno: DataTypes.BIGINT,
    tx_hash: DataTypes.TEXT,
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { tableName: 'ton_payments', timestamps: false }
)

GiftModel.belongsTo(Collection, { foreignKey: 'fk_collection_id', onDelete: 'CASCADE' })
Collection.hasMany(GiftModel, { foreignKey: 'fk_collection_id' })

CollectionBackground.belongsTo(Collection, { foreignKey: 'fk_collection_id', onDelete: 'CASCADE' })
CollectionBackground.belongsTo(Background, { foreignKey: 'fk_background_id', onDelete: 'CASCADE' })

CollectionSymbol.belongsTo(Collection, { foreignKey: 'fk_collection_id', onDelete: 'CASCADE' })
CollectionSymbol.belongsTo(GiftSymbol, { foreignKey: 'fk_symbol_id', onDelete: 'CASCADE' })

// Join metadata only. The database enforces composite keys instead: model,
// background and symbol must belong to the gift's collection.
Gift.belongsTo(Collection, { foreignKey: 'fk_collection_id', onDelete: 'RESTRICT' })
Gift.belongsTo(GiftModel, { foreignKey: 'fk_model_id', onDelete: 'RESTRICT' })
Gift.belongsTo(Background, { foreignKey: 'fk_background_id', onDelete: 'RESTRICT' })
Gift.belongsTo(GiftSymbol, { foreignKey: 'fk_symbol_id', onDelete: 'RESTRICT' })
Gift.hasOne(GiftListing, { as: 'ActiveListing', foreignKey: 'fk_gift_id', scope: { status: 'active' } })
GiftListing.belongsTo(Gift, { foreignKey: 'fk_gift_id', onDelete: 'SET NULL' })
GiftListing.belongsTo(User, { as: 'Seller', foreignKey: 'fk_seller_user_id', onDelete: 'CASCADE' })
GiftListing.belongsTo(User, { as: 'Buyer', foreignKey: 'fk_buyer_user_id', onDelete: 'SET NULL' })

Ownership.belongsTo(User, { foreignKey: 'fk_user_id', onDelete: 'CASCADE' })
Ownership.belongsTo(Gift, { foreignKey: 'fk_gift_id', onDelete: 'CASCADE' })
WalletBalance.belongsTo(User, { foreignKey: 'fk_user_id', onDelete: 'CASCADE' })
WalletTransaction.belongsTo(User, { foreignKey: 'fk_user_id', onDelete: 'CASCADE' })
WalletTransaction.belongsTo(Gift, { foreignKey: 'fk_gift_id', onDelete: 'SET NULL' })
Offer.belongsTo(Gift, { foreignKey: 'fk_gift_id', onDelete: 'SET NULL' })
Offer.belongsTo(User, { as: 'Buyer', foreignKey: 'fk_buyer_user_id', onDelete: 'CASCADE' })
Offer.belongsTo(User, { as: 'Seller', foreignKey: 'fk_seller_user_id', onDelete: 'CASCADE' })
MarketplaceFeeEntry.belongsTo(GiftListing, { foreignKey: 'fk_gift_listing_id', onDelete: 'RESTRICT' })
MarketplaceFeeEntry.belongsTo(Offer, { foreignKey: 'fk_offer_id', onDelete: 'RESTRICT' })
MarketplaceFeeEntry.belongsTo(WalletTransaction, { as: 'LegacyTransaction', foreignKey: 'fk_legacy_wallet_tx_id', onDelete: 'RESTRICT' })
