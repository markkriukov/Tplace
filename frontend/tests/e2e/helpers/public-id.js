// Stable UUIDv7 values for API entities and pagination cursors.
export const publicId = number => `019a0000-0000-7000-8000-${number.toString(16).padStart(12, '0')}`
