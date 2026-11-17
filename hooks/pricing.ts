// Anthropic first-party API list prices, USD per million tokens, checked 2026-10.
// Unknown model IDs stay unpriced; family-only matching can silently misstate costs.
type ModelPrice = {
  id: string
  label: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  longContext?: { threshold: number; input: number; output: number; cacheRead: number; cacheWrite: number }
}

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  model?: string
}

const PRICES: readonly ModelPrice[] = [
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    longContext: { threshold: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
  },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  { id: 'claude-opus-5', label: 'Claude Opus 5', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { id: 'claude-opus-4-5', label: 'Claude Opus 4.5', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { id: 'claude-opus-4-1', label: 'Claude Opus 4.1', input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  { id: 'claude-opus-4', label: 'Claude Opus 4', input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { id: 'claude-sonnet-4', label: 'Claude Sonnet 4', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  { id: 'claude-haiku-3-5', label: 'Claude Haiku 3.5', input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  { id: 'claude-haiku-3', label: 'Claude Haiku 3', input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },
]

// The ID must stand alone: not glued to more version digits (`claude-sonnet-5-50`),
// nor followed by `-<digit>` unless that is a dated snapshot (`-20251001`).
// Provider prefixes (`us.anthropic.`) and suffixes (`-v1:0`, `[1m]`, `-latest`) stay accepted.
function modelPrice(model?: string) {
  if (!model) return undefined
  const normalized = model.trim().toLowerCase().replace(/[._\s]+/g, '-')

  return PRICES.find(price => new RegExp(`(?:^|[^a-z0-9])${price.id}(?:$|-\\d{8}(?!\\d)|-(?!\\d)|[^a-z0-9-])`).test(normalized))
}

function rates(price: ModelPrice, inputTokens?: number) {
  if (!price.longContext) return price
  if (inputTokens === undefined || !Number.isFinite(inputTokens)) return undefined

  return inputTokens > price.longContext.threshold
    ? { ...price, input: price.longContext.input, output: price.longContext.output, cacheRead: price.longContext.cacheRead, cacheWrite: price.longContext.cacheWrite }
    : price
}

export function inputPriceForModel(model: string | undefined, inputTokens?: number) {
  const found = modelPrice(model)
  return found ? rates(found, inputTokens)?.input : undefined
}

export function priceModelLabel(model: string | undefined) {
  return modelPrice(model)?.label
}

// Cache creation is priced at the standard 5-minute write rate because the
// session event reports aggregate cache-created tokens without a TTL split.
export function runCost(usage: Usage | undefined): number | undefined {
  if (!usage) return undefined
  const found = modelPrice(usage.model)
  const inputTokens = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  const price = found ? rates(found, inputTokens) : undefined
  if (!price) return undefined

  return (
    (usage.input_tokens * price.input +
      usage.output_tokens * price.output +
      usage.cache_read_input_tokens * price.cacheRead +
      usage.cache_creation_input_tokens * price.cacheWrite) /
    1_000_000
  )
}
