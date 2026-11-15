const API_URL = 'https://api.changes.tg'
const REQUEST_TIMEOUT_MS = 20_000
const MAX_ATTEMPTS = 3

function requireName(value, context) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Changes API: missing name in ${context}`)
  }
  return value.trim()
}

function requireList(value, context) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Changes API: empty or invalid ${context}`)
  }
  return value
}

function rarityPerMille(value, context) {
  // /gift returns percentages; the database and Telegram use parts per thousand.
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`Changes API: invalid rarity in ${context}`)
  }
  return String(Number((value * 10).toFixed(6)))
}

async function requestJson(path, fetchImpl) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(`${API_URL}${path}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) {
        await response.body?.cancel()
        const error = new Error(`Changes API ${path}: HTTP ${response.status}`)
        error.retryable = response.status === 429 || response.status >= 500
        throw error
      }
      return await response.json()
    } catch (error) {
      const retryable = error.retryable || error instanceof TypeError ||
        error.name === 'TimeoutError' || error.name === 'AbortError'
      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw new Error(`Could not load Changes API ${path}: ${error.message}`, { cause: error })
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    }
  }
}

function parseBackdrops(payload) {
  const backgrounds = new Map()
  for (const backdrop of requireList(payload, 'backdrops')) {
    const name = requireName(backdrop?.name, 'backdrops')
    if (backgrounds.has(name)) throw new Error(`Changes API: duplicate backdrop ${name}`)
    const row = { name }
    for (const [apiField, dbField] of [
      ['centerColor', 'center_color'], ['edgeColor', 'edge_color'],
      ['patternColor', 'pattern_color'], ['textColor', 'text_color'],
    ]) {
      const color = backdrop[apiField]
      if (!Number.isInteger(color) || color < 0 || color > 0xffffff) {
        throw new Error(`Changes API: invalid ${apiField} for ${name}`)
      }
      row[dbField] = color
    }
    backgrounds.set(name, row)
  }
  return backgrounds
}

export function parseChangesCatalog(giftPayloads, backdropPayload) {
  const backgrounds = parseBackdrops(backdropPayload)
  const collections = []
  const models = []
  const symbols = new Map()
  const collectionBackgroundLinks = []
  const collectionSymbolLinks = []
  const collectionIds = new Set()
  const collectionNames = new Set()

  for (const payload of requireList(giftPayloads, 'gift details')) {
    const displayName = requireName(payload?.gift?.name, 'gift')
    const id = payload.gift.id
    // Reject numeric IDs: JSON numbers may already have lost Telegram ID precision.
    if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id) || BigInt(id) > 9223372036854775807n) {
      throw new Error(`Changes API: invalid gift ID for ${displayName}`)
    }
    const shortName = displayName.replace(/[^a-z0-9]/gi, '')
    if (!shortName || collectionIds.has(id) || collectionNames.has(shortName.toLowerCase())) {
      throw new Error(`Changes API: duplicate or invalid collection ${displayName}`)
    }
    collectionIds.add(id)
    collectionNames.add(shortName.toLowerCase())
    collections.push({
      short_name: shortName,
      display_name: displayName,
      collection_regular_id: id,
      photo_url: `${API_URL}/original/${id}.png`,
    })

    for (const kind of ['models', 'backdrops', 'symbols']) {
      const names = new Set()
      for (const attribute of requireList(payload[kind], `${displayName} ${kind}`)) {
        const name = requireName(attribute?.name, `${displayName} ${kind}`)
        if (names.has(name)) throw new Error(`Changes API: duplicate ${kind} ${displayName}/${name}`)
        names.add(name)
        const rarity = rarityPerMille(attribute.rarity, `${displayName}/${name}`)
        if (kind === 'models') {
          models.push({
            collection_regular_id: id, name, rarity,
            url: `${API_URL}/model/${id}/${encodeURIComponent(name)}.png`,
          })
        } else if (kind === 'backdrops') {
          if (!backgrounds.has(name)) throw new Error(`Changes API: unknown backdrop ${name}`)
          collectionBackgroundLinks.push({ collection_regular_id: id, name, rarity })
        } else {
          if (!symbols.has(name)) {
            symbols.set(name, { name, url: `${API_URL}/symbol/${id}/${encodeURIComponent(name)}.png` })
          }
          collectionSymbolLinks.push({ collection_regular_id: id, name, rarity })
        }
      }
    }
  }

  return {
    collections, models, backgrounds: [...backgrounds.values()], symbols: [...symbols.values()],
    collectionBackgroundLinks, collectionSymbolLinks,
  }
}

export async function loadChangesCatalog({ fetchImpl = globalThis.fetch, onProgress = () => {} } = {}) {
  const giftNames = requireList(await requestJson('/gifts', fetchImpl), 'gifts')
    .map((name) => requireName(name, 'gifts'))
  if (new Set(giftNames).size !== giftNames.length) throw new Error('Changes API: duplicate gifts')
  const backdrops = await requestJson('/backdrops', fetchImpl)
  // Fetch details in a small pool; preserve API order for shared symbol URLs.
  const details = new Array(giftNames.length)
  let next = 0
  let completed = 0
  let failed = false
  await Promise.all(Array.from({ length: Math.min(4, giftNames.length) }, async () => {
    while (!failed && next < giftNames.length) {
      const index = next++
      try {
        details[index] = await requestJson(`/gift/${encodeURIComponent(giftNames[index])}`, fetchImpl)
        completed += 1
        onProgress(completed, giftNames.length)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }))
  return parseChangesCatalog(details, backdrops)
}
