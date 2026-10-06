import { expect, test } from 'claude-code/testing'

import { describeJev, describeSaving } from '../hooks/eco'

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
