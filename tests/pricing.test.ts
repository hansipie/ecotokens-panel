import { expect, test } from 'claude-code/testing'
import { inputPriceForModel, priceModelLabel, runCost } from '../hooks/pricing'

test('model-specific API input prices do not collapse to family-wide rates', () => {
  expect(inputPriceForModel('claude-opus-5-5')).toBe(4)
  expect(inputPriceForModel('claude-sonnet-5-5-20261007')).toBe(2)
  expect(inputPriceForModel('claude-haiku-4-5-20251001')).toBe(1)
  expect(priceModelLabel('claude-opus-5-5')).toBe('Claude Opus 5.5')
  expect(inputPriceForModel('a-model-we-do-not-know')).toBeUndefined()
})

test('model IDs match exactly: unknown versions stay unpriced, snapshots and provider forms are priced', () => {
  expect(inputPriceForModel('claude-opus-4-9')).toBeUndefined()
  expect(inputPriceForModel('claude-sonnet-5-50')).toBeUndefined()
  expect(inputPriceForModel('claude-opus-4-20250514')).toBe(15)
  expect(inputPriceForModel('claude-opus-4-1-20250805')).toBe(15)
  expect(inputPriceForModel('claude-haiku-3-5-latest')).toBe(0.8)
  expect(inputPriceForModel('us.anthropic.claude-sonnet-5-5-20261007-v1:0')).toBe(2)
  expect(inputPriceForModel('Claude Opus 4.8')).toBe(5)
  expect(inputPriceForModel('claude-opus-4.8')).toBe(5)
})

test('Haiku 5.5 needs the prompt size to select its input price tier', () => {
  expect(inputPriceForModel('claude-haiku-5-5')).toBeUndefined()
  expect(inputPriceForModel('claude-haiku-5-5', 100_000)).toBe(0.1)
  expect(inputPriceForModel('claude-haiku-5-5', 100_001)).toBe(0.5)
})

test('usage cost accounts for model-specific input, output, cache read and cache creation prices', () => {
  const sonnet = {
    input_tokens: 1_000,
    output_tokens: 2_000,
    cache_read_input_tokens: 30_000,
    cache_creation_input_tokens: 10_000,
    model: 'claude-sonnet-5-5',
  }
  expect(runCost(sonnet)).toBe(0.05)

  const haiku = {
    ...sonnet,
    input_tokens: 101_000,
    output_tokens: 1_000,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    model: 'claude-haiku-5-5',
  }
  // Over 100k prompt tokens Haiku 5.5 bills input at $0.50 and output at $2.50 per million.
  expect(runCost(haiku)).toBe(0.053)
  expect(runCost({ ...sonnet, model: 'unknown-model' })).toBeUndefined()
})
