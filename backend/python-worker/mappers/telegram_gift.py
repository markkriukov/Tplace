import re
from typing import Any
from pyrogram.enums import GiftAttributeType


def first_attribute(obj: Any, *candidates: str, default: Any = None) -> Any:
    for key in candidates:
        if hasattr(obj, key):
            val = getattr(obj, key)
            if val is not None:
                return val
    return default


def _enum_name(value: Any) -> str:
    if value is None:
        return ''
    enum_name = first_attribute(value, 'name', default=None)
    if enum_name is not None:
        return str(enum_name).upper()
    return str(value).upper()


def telegram_display_name(first_name: str | None, username: str | None, fallback: str) -> str:
    if first_name:
        return first_name
    if username:
        return username
    return fallback


def _attribute_by_type(attributes: list[Any], attr_type: GiftAttributeType) -> Any | None:
    target = _enum_name(attr_type)
    for attribute in attributes:
        attribute_type = first_attribute(attribute, 'type', default=None)
        if attribute_type == attr_type:
            return attribute
        if _enum_name(attribute_type) == target:
            return attribute
    return None


def _resolve_gift_attributes(gift: Any) -> tuple[Any | None, Any | None, Any | None, Any | None]:
    model_attr = first_attribute(gift, 'model', default=None)
    symbol_attr = first_attribute(gift, 'symbol', default=None)
    backdrop_attr = first_attribute(gift, 'backdrop', default=None)
    original_details = first_attribute(gift, 'original_details', default=None)

    if model_attr is None or symbol_attr is None or backdrop_attr is None:
        attributes = list(first_attribute(gift, 'attributes', default=[]))
        if model_attr is None:
            model_attr = _attribute_by_type(attributes, GiftAttributeType.MODEL)
        if symbol_attr is None:
            symbol_attr = _attribute_by_type(attributes, GiftAttributeType.SYMBOL)
        if backdrop_attr is None:
            backdrop_attr = _attribute_by_type(attributes, GiftAttributeType.BACKDROP)

    return model_attr, symbol_attr, backdrop_attr, original_details


def normalize_collection_key(value: str | None) -> str:
    return re.sub(r'[^a-z0-9]+', '', str(value or '').strip().lower())


def _extract_text(gift: Any, user_display_name: str, original_details: Any | None) -> tuple[str, str, str | None]:
    sender = first_attribute(original_details, 'from_user', default=None) or first_attribute(gift, 'from_user', 'sender', default=None)
    from_name = telegram_display_name(
        first_attribute(sender, 'first_name', default=None),
        first_attribute(sender, 'username', default=None),
        'Unknown Sender',
    )
    receiver = first_attribute(original_details, 'to_user', default=None) or first_attribute(gift, 'receiver', 'owner', default=None)
    receiver_name = telegram_display_name(
        first_attribute(receiver, 'first_name', default=None),
        first_attribute(receiver, 'username', default=None),
        user_display_name,
    )
    to_name = str(first_attribute(gift, 'owner_name', default=receiver_name))
    caption = first_attribute(original_details, 'caption', default=None)
    if caption is None:
        caption = first_attribute(gift, 'caption', default=None)
    return from_name, to_name, caption


def _extract_name(gift: Any, telegram_gift_id: int) -> str:
    name = first_attribute(gift, 'slug', 'name', 'title', default=None)
    if isinstance(name, str) and name.strip():
        return name.strip()
    return f'Gift {telegram_gift_id}'


def _attribute_name(attribute: Any | None) -> str | None:
    name = first_attribute(attribute, 'name', default=None)
    return name.strip() if isinstance(name, str) and name.strip() else None


def _collection_keys(gift: Any, name: str) -> set[str]:
    """Normalized names that may identify the gift's catalog collection."""
    match = re.fullmatch(r'([A-Za-z][A-Za-z0-9]*)-([1-9][0-9]*)', name)
    candidates = (first_attribute(gift, 'collection', default=None), first_attribute(gift, 'title', default=None),
                  match[1] if match else None)
    return {key for key in map(normalize_collection_key, candidates) if key}


def prepare_gift(gift: Any, user_display_name: str) -> dict[str, Any]:
    """Telegram data used to find the gift's attributes in the catalog."""
    telegram_gift_id = int(first_attribute(gift, 'id', default=0))
    name = _extract_name(gift, telegram_gift_id)
    model, symbol, backdrop, original_details = _resolve_gift_attributes(gift)
    regular_gift_id = first_attribute(gift, 'regular_gift_id', default=None)
    return {
        'telegram_gift_id': telegram_gift_id,
        'name': name,
        'regular_gift_id': int(regular_gift_id) if regular_gift_id is not None else None,
        'collection_keys': _collection_keys(gift, name),
        'model': _attribute_name(model),
        'symbol': _attribute_name(symbol),
        'backdrop': (_attribute_name(backdrop), first_attribute(backdrop, 'backdrop_id', default=None)),
        'text': _extract_text(gift, user_display_name, original_details),
    }


def is_regular_gift(gift: Any) -> bool:
    gift_type = _enum_name(first_attribute(gift, 'type', default=None))
    if 'UPGRADED' in gift_type or 'UNIQUE' in gift_type:
        return False
    if 'REGULAR' in gift_type:
        return True

    return first_attribute(gift, 'regular_gift_id', default=None) is None
