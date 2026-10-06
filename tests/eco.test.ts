import { expect, test } from 'claude-code/testing'

import { callKey, describeJev, describeSaving, ecoLog, groupLine, markLine, matchMarks, turnLine } from '../hooks/eco'
import type { MarkRow } from '../hooks/eco'

test('a saving names its object and its means', () => {
  expect(describeSaving('Read /a/b/register.tsx', 'native_read', 'filtered', 1250, 75)).toEqual({
    what: 'Lecture du fichier register.tsx',
    how: 'Sortie filtrée (lignes inutiles retirées) · 1250 → 75 tokens',
  })
  expect(describeSaving('bash -c cd /repo && git --no-pager diff --stat', 'git', 'summarized', 900, 100).what).toBe(
    'Commande git : git --no-pager diff --stat',
  )
  expect(describeSaving('hermes-tool:read_file', 'fs', 'summarized', 10, 5).what).toBe('Outil Hermes read_file')
  expect(describeSaving('bash -c ls', 'weird', 'other', 2, 1)).toEqual({ what: 'Commande weird : ls', how: 'other · 2 → 1 tokens' })
})

test('a Jev call says what it was asked and decided', () => {
  const d = { size: 'tiny', confidence: 0.41, followup: 0.52 }
  expect(describeJev('router', 'self (followup)', true, d).what).toBe(
    'Message jugé très petit (p=0.41), suite de conversation (p=0.52) → gardé par la session',
  )
  expect(describeJev('router', 'self (unsure)', true, d).what).toBe('Message jugé très petit (p=0.41), trop incertain → gardé par la session')
  expect(describeJev('router', 'router-large', true, { size: 'large', confidence: 0.9, followup: 0 }).what).toBe(
    'Message jugé gros (p=0.90) → délégué à router-large (Opus)',
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

test('the lines say what was saved, under a call, a group and a turn', () => {
  expect(markLine({ before: 12_400, after: 1_100, mode: 'summarized' })).toBe('ecotokens · 12.4k → 1.1k (−91 %) · résumé IA')
  expect(markLine({ before: 1250, after: 75, mode: 'filtered' })).toBe('ecotokens · 1.3k → 75 (−94 %) · filtré')
  expect(groupLine([{ before: 5000, after: 500, mode: 'filtered' }])).toBe('ecotokens · 1 sortie filtrée · −4.5k tokens')
  expect(groupLine([{ before: 5000, after: 500, mode: 'filtered' }, { before: 2000, after: 200, mode: 'filtered' }])).toBe(
    'ecotokens · 2 sorties filtrées · −6.3k tokens',
  )

  const jev = { timestamp: '2026-10-06T09:16:27.735119961+00:00', purpose: 'router', agent: 'router-everyday', ok: 1, error_kind: null, http_status: null, latency_ms: 595, input_tokens: 564, output_tokens: 67, size: 'everyday', confidence: 0.76, followup_prob: 0.1 }
  const totals = JSON.stringify([{ saved: 24_100, filtered: 3 }])
  const line = turnLine(ecoLog({ savings: '', totals, jev: JSON.stringify([jev]) }, 0))
  expect(line).toBe('ecotokens · 3 sorties filtrées · −24.1k tokens · Jev : Message jugé courant (p=0.76) → délégué à router-everyday (Sonnet)')
  // A turn in which ecotokens did nothing draws nothing.
  expect(turnLine(ecoLog({ savings: '', totals: JSON.stringify([{ saved: null, filtered: 0 }]), jev: '' }, 0))).toBeUndefined()
})
