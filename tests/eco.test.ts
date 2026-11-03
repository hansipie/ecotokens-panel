import { expect, test } from 'claude-code/testing'
import { configureLocale, formatNumber, formatPercent, formatUsd } from '../hooks/i18n'
import { kTokens } from '../hooks/eco'

configureLocale({ ECOTOKENS_PANEL_LANG: 'fr' })

import { callKey, describeJev, describeSaving, ecoLog, ecoQueries, ecoSavedQuery, groupLine, markLine, matchMarks, parsePrice, parseSaved, resolveEcoRate, turnLine } from '../hooks/eco'
import type { MarkRow } from '../hooks/eco'

test('a saving names its object and its means', () => {
  expect(describeSaving('Read /a/b/register.tsx', 'native_read', 'filtered', 1250, 75)).toEqual({
    what: 'Lecture du fichier register.tsx',
    how: `Sortie filtrée (lignes inutiles retirées) · ${formatNumber(1250)} → ${formatNumber(75)} tokens`,
  })
  expect(describeSaving('bash -c cd /repo && git --no-pager diff --stat', 'git', 'summarized', 900, 100).what).toBe(
    'Commande git : git --no-pager diff --stat',
  )
  expect(describeSaving('hermes-tool:read_file', 'fs', 'summarized', 10, 5).what).toBe('Outil Hermes read_file')
  expect(describeSaving('bash -c ls', 'weird', 'other', 2, 1)).toEqual({ what: 'Commande weird : ls', how: 'other · 2 → 1 tokens' })
})

test('EcoTokens queries use the Windows AppData databases', () => {
  const queries = ecoQueries('C:\\Users\\crine', Date.parse('2026-10-25T10:00:00Z'), 'C:\\repo', {
    platform: 'win32',
    appData: 'C:\\Users\\crine\\AppData\\Roaming',
  })

  expect(queries.savings.argv[5]).toBe('C:\\Users\\crine\\AppData\\Roaming\\ecotokens\\metrics.db')
  expect(queries.totals.argv[5]).toBe('C:\\Users\\crine\\AppData\\Roaming\\ecotokens\\metrics.db')
  expect(queries.jev.argv[5]).toBe('C:\\Users\\crine\\AppData\\Roaming\\ecotokens\\router.db')
  expect(ecoSavedQuery('C:\\Users\\crine', 0, 'C:\\repo', { platform: 'win32', appData: 'C:\\Users\\crine\\AppData\\Roaming' }).argv[5]).toBe(
    'C:\\Users\\crine\\AppData\\Roaming\\ecotokens\\metrics.db',
  )
})

test('a Jev call says what it was asked and decided', () => {
  const d = { size: 'tiny', confidence: 0.41, followup: 0.52 }
  expect(describeJev('router', 'self (followup)', true, d).what).toBe(
    `Message jugé très petit (p=${formatNumber(0.41, 2)}), suite de conversation (p=${formatNumber(0.52, 2)}) → gardée par la session`,
  )
  expect(describeJev('router', 'self (unsure)', true, d).what).toBe(`Message jugé très petit (p=${formatNumber(0.41, 2)}), trop incertain → gardé par la session`)
  expect(describeJev('router', 'router-large', true, { size: 'large', confidence: 0.9, followup: 0 }).what).toBe(
    `Message jugé gros (p=${formatNumber(0.90, 2)}) → délégué à router-large (Opus)`,
  )
  expect(describeJev('router', null, false, null).what).toBe('Échec : traité par la session principale')
  expect(describeJev('filter_lines', null, true, null).what).toBe('Jev a choisi les lignes utiles à garder')
})

const row = (id: string, timestamp: string, command: string, before = 1000, after = 100, extra: Partial<MarkRow> = {}): MarkRow => ({
  id,
  timestamp,
  command,
  cut: 0,
  tokens_before: before,
  tokens_after: after,
  mode: 'filtered',
  ...extra,
})

test('a call is worded as ecotokens words it', () => {
  expect(callKey('Bash', { command: 'git  status\n  --short' })).toBe('git status --short')
  expect(callKey('Bash', { command: 'bash -c ls' })).toBe('ls')
  expect(callKey('Read', { file_path: '/a/b.ts' })).toBe('Read /a/b.ts')
  expect(callKey('Grep', { pattern: 'x' })).toBeUndefined()
})

test('a saving goes to the call of the same command that ran at that time', () => {
  const track = {
    calls: [
      { id: 'tu1', key: 'git diff', startedAt: Date.parse('2026-10-06T10:00:00Z'), endedAt: Date.parse('2026-10-06T10:00:02Z') },
      { id: 'tu2', key: 'git diff', startedAt: Date.parse('2026-10-06T10:05:00Z'), endedAt: Date.parse('2026-10-06T10:05:02Z') },
      { id: 'tu3', key: 'ls', startedAt: Date.parse('2026-10-06T10:05:10Z'), endedAt: Date.parse('2026-10-06T10:05:11Z') },
    ],
    claimed: [],
  }
  const rows = [
    row('r1', '2026-10-06T09:59:59.500123456+00:00', 'bash -c git diff', 3000, 300, { mode: 'summarized' }),
    row('r2', '2026-10-06T10:05:01.000000000+00:00', 'bash -c git diff', 900, 90),
  ]
  const { track: left, marks } = matchMarks(track, rows, Date.parse('2026-10-06T10:05:12Z'))
  // Same command twice: each call takes the row written around its own run.
  expect(marks).toEqual([
    { id: 'tu1', mark: { before: 3000, after: 300, mode: 'summarized' } },
    { id: 'tu2', mark: { before: 900, after: 90, mode: 'filtered' } },
  ])
  // `ls` saved nothing yet: it waits, with the rows already given kept apart.
  expect(left.calls.map(c => c.id)).toEqual(['tu3'])
  expect(left.claimed).toEqual(['r1', 'r2'])
  // Nothing comes for it once a row can no longer be written.
  expect(matchMarks(left, rows, Date.parse('2026-10-06T10:05:40Z')).track.calls).toEqual([])
  // A row already given does not go to a later call.
  expect(matchMarks({ calls: [track.calls[0]!], claimed: ['r1'] }, rows, 0).marks).toEqual([])
})

test('a command cut at 200 characters is matched by its start', () => {
  const long = `echo ${'x'.repeat(300)}`
  const call = { id: 'tu1', key: long, startedAt: 1_000, endedAt: 2_000 }
  const at = new Date(1_500).toISOString()
  const cut = row('r1', at, `bash -c ${long}`.slice(0, 200), 800, 80, { cut: 1 })
  expect(matchMarks({ calls: [call], claimed: [] }, [cut], 2_000).marks).toHaveLength(1)
  // A short command is not the start of a longer one.
  const short = row('r2', at, 'bash -c echo')
  expect(matchMarks({ calls: [call], claimed: [] }, [short], 2_000).marks).toHaveLength(0)
})

test('the lines say only what was saved: tokens, share and avoided cost', () => {
  expect(markLine({ before: 12_400, after: 1_100, mode: 'summarized' }, 2)).toBe(`ecotokens · −${kTokens(11_300)} tokens (−${formatPercent(11_300, 12_400, 0)}) · ≈ ${formatUsd(0.0226)}`)
  expect(markLine({ before: 1250, after: 75, mode: 'filtered' })).toBe(`ecotokens · −${kTokens(1_175)} tokens (−${formatPercent(1_175, 1250, 0)})`)
  // Under a cent, and never $0.00 for a known price.
  expect(markLine({ before: 1250, after: 75, mode: 'filtered' }, 2)).toBe(`ecotokens · −${kTokens(1_175)} tokens (−${formatPercent(1_175, 1250, 0)}) · < ${formatUsd(0.01)}`)
  expect(groupLine([{ before: 5000, after: 500, mode: 'filtered' }, { before: 2000, after: 200, mode: 'filtered' }], 2)).toBe(
    `ecotokens · −${kTokens(6_300)} tokens (−${formatPercent(6_300, 7_000, 0)}) · ≈ ${formatUsd(0.0126)}`,
  )
  expect(markLine({ before: 12_400, after: 1_100, mode: 'summarized' }, 2, 'Claude Opus 5.5')).toContain(
    `≈ ${formatUsd(0.0226)} estimation API (Claude Opus 5.5)`,
  )

  const turn = { before: 27_700, after: 3_600 }
  const session = { before: 330_000, after: 18_000 }
  expect(turnLine(turn, session, 2)).toBe(`ecotokens · −${kTokens(24_100)} tokens (−${formatPercent(24_100, 27_700, 0)}) · ≈ ${formatUsd(0.0482)} · session −${kTokens(312_000)} tokens · ≈ ${formatUsd(0.624)}`)
  expect(turnLine(turn, session, 2, 'Claude Sonnet 5.5', false)).toBe(
    `ecotokens · −${kTokens(24_100)} tokens (−${formatPercent(24_100, 27_700, 0)}) · ≈ ${formatUsd(0.0482)} estimation API (Claude Sonnet 5.5) · session −${kTokens(312_000)} tokens`,
  )
  expect(turnLine(turn, session)).toBe(`ecotokens · −${kTokens(24_100)} tokens (−${formatPercent(24_100, 27_700, 0)}) · session −${kTokens(312_000)} tokens`)
  // A turn in which ecotokens saved nothing draws nothing.
  expect(turnLine({ before: 0, after: 0 }, session, 2)).toBeUndefined()
})

test('the price comes from the ecotokens config, and is absent when unset or unreadable', () => {
  expect(parsePrice('{"price_input_usd_per_mtok": 2.0}')).toBe(2)
  expect(parsePrice('{"price_input_usd_per_mtok": 0}')).toBe(0)
  expect(parsePrice('{"other": 1}')).toBeUndefined()
  expect(parsePrice('{"price_input_usd_per_mtok": null}')).toBeUndefined()
  expect(parsePrice('not json')).toBeUndefined()
})

test('an explicit global price wins; otherwise estimate by active model and prompt size', () => {
  expect(resolveEcoRate(undefined, 'claude-opus-5-5')).toEqual({ price: 4, model: 'Claude Opus 5.5', configured: false })
  expect(resolveEcoRate(undefined, 'claude-haiku-5-5')).toBeUndefined()
  expect(resolveEcoRate(undefined, 'claude-haiku-5-5', 100_000)).toEqual({ price: 0.1, model: 'Claude Haiku 5.5', configured: false })
  expect(resolveEcoRate(undefined, 'claude-haiku-5-5', 100_001)).toEqual({ price: 0.5, model: 'Claude Haiku 5.5', configured: false })
  expect(resolveEcoRate(undefined, 'unknown-model')).toBeUndefined()
  expect(resolveEcoRate('{"price_input_usd_per_mtok": 7}', 'claude-opus-5-5')).toEqual({ price: 7, configured: true })
  expect(resolveEcoRate('{"price_input_usd_per_mtok": 0}', 'claude-opus-5-5')).toEqual({ price: 0, configured: true })
})

test('zero input price is a configured price and reports zero avoided cost', () => {
  expect(turnLine({ before: 1000, after: 100 }, { before: 1000, after: 100 }, 0)).toContain(`≈ ${formatUsd(0)}`)
})

test('the saved totals skip Rewritten rows, as ecotokens gain does', () => {
  expect(ecoSavedQuery('/home/me', 0, '/p').argv.at(-1)).toContain("mode != 'rewritten'")
  expect(parseSaved('')).toEqual({ before: 0, after: 0 })
  expect(parseSaved('[{"before":null,"after":null}]')).toEqual({ before: 0, after: 0 })
})
