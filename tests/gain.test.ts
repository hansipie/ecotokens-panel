import { expect, test } from 'claude-code/testing'

import { gainCommand, jevCommand, parseGain, parseJev, sparkline } from '../hooks/gain'

test('the controls pass the period to ecotokens', () => {
  expect(gainCommand('week', '/p')).toEqual(['ecotokens', 'gain', '--period', 'week', '--project', '/p', '--json'])
  expect(jevCommand('all', '/p')).toEqual(['ecotokens', 'jev', '--period', 'all', '--project', '/p', '--json'])
})

test('the gain report keeps totals and sorts rows by tokens saved', () => {
  const g = parseGain(JSON.stringify({
    total_interceptions: 257, total_tokens_before: 136_867, total_tokens_after: 64_226, total_savings_pct: 53.07, cost_avoided_usd: 0.145,
    by_family: { git: { count: 6, tokens_before: 2239, tokens_after: 1655 }, generic: { count: 197, tokens_before: 86_260, tokens_after: 52_298 } },
  }))
  expect(g.interceptions).toBe(257)
  expect(g.savingsPct).toBe(53.07)
  expect(g.families.map(r => r.name)).toEqual(['generic', 'git'])
  expect(() => parseGain('[]')).toThrow()
})

test('the jev report drops idle purposes and empty errors', () => {
  const j = parseJev(JSON.stringify({
    calls: 62, ok: 61, fallbacks: 1, input_tokens: 127_211, output_tokens: 30_291, cost_usd: 0.0053, avg_latency_ms: 520, p95_latency_ms: 1191,
    by_purpose: {
      router: { calls: 58, ok: 58, input_tokens: 38_066, output_tokens: 3852, avg_latency_ms: 512 },
      verify: { calls: 0, ok: 0 },
      filter_lines: { calls: 4, ok: 3, avg_latency_ms: 636 },
    },
    errors: { timeout: 1, http: 0 },
    timeline: [0, 2, 4],
  }))
  expect(j.purposes.map(p => p.name)).toEqual(['router', 'filter_lines'])
  expect(j.errors).toEqual([{ kind: 'timeout', count: 1 }])
  expect(j.timeline).toEqual([0, 2, 4])
  expect(j.p95LatencyMs).toBe(1191)
})

test('the sparkline scales to the busiest bucket', () => {
  expect(sparkline([0, 4, 8], 10)).toBe('▁▅█')
  expect(sparkline([0, 0], 10)).toBe('▁▁')
  expect(sparkline([1, 2, 3, 8], 2)).toBe('▄█')
})
