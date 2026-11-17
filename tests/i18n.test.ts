import { expect, test } from 'claude-code/testing'

import { en } from '../locales/en'
import { fr } from '../locales/fr'
import { hi } from '../locales/hi'
import { configureLocale, formatNumber, formatPercent, formatUsd, locale, resolveLocale, t, tp } from '../hooks/i18n'
import { taskKindLabel } from '../hooks/agents'
import { GAIN_PERIODS, purposeLabel } from '../hooks/gain'

configureLocale({ ECOTOKENS_PANEL_LANG: 'fr' })

test('locale selection prefers an explicit override, then the system locale, then English', () => {
  expect(resolveLocale('fr_CA', 'hi-IN')).toBe('fr')
  expect(resolveLocale('unsupported', 'hi-IN')).toBe('hi')
  expect(resolveLocale('unsupported', 'also-unsupported')).toBe('en')
})

test('the hook runtime can apply its environment locale after module loading', () => {
  const previous = locale
  const systemFallback = resolveLocale(undefined, Intl.DateTimeFormat().resolvedOptions().locale)
  try {
    configureLocale({ ECOTOKENS_PANEL_LANG: 'hi-IN', LANG: 'fr_FR' })
    expect(locale).toBe('hi')
    configureLocale({ ECOTOKENS_PANEL_LANG: 'unsupported', LANG: 'fr_FR' })
    expect(locale).toBe('fr')
    configureLocale({ ECOTOKENS_PANEL_LANG: 'unsupported', LANG: 'not-a-locale' })
    expect(locale).toBe(systemFallback)
  } finally {
    configureLocale({ ECOTOKENS_PANEL_LANG: previous })
  }
})

test('English, French, and Hindi catalogs have matching keys and interpolation placeholders', () => {
  const catalogs = [fr, hi]
  const englishKeys = Object.keys(en).sort()

  for (const catalog of catalogs) {
    expect(Object.keys(catalog).sort()).toEqual(englishKeys)
    for (const key of englishKeys) {
      const englishValue = en[key as keyof typeof en]
      const translatedValue = catalog[key as keyof typeof catalog]
      const englishForms = typeof englishValue === 'string' ? [englishValue] : Object.values(englishValue)
      const translatedForms = typeof translatedValue === 'string' ? [translatedValue] : Object.values(translatedValue)
      const placeholders = (value: string) => [...value.matchAll(/\{([\w.]+)\}/g)].map(match => match[1]).sort()

      for (const form of translatedForms) expect(placeholders(form)).toEqual(placeholders(englishForms[0]!))
    }
  }
})

test('translations interpolate values and plural messages receive the localized count', () => {
  expect(t('panel.ecoSessionSummary', { saved: '25', filtered: '4', unit: 'tokens' })).not.toContain('{')
  expect(tp('count.sessions', 2)).toContain('2')
  expect(['en', 'fr', 'hi']).toContain(locale)
})

test('labels declared before locale selection resolve in the active language when displayed', () => {
  const previous = locale
  try {
    configureLocale({ ECOTOKENS_PANEL_LANG: 'fr' })
    expect(taskKindLabel('remote_agent')).toBe('Agent distant')
    expect(purposeLabel('router')).toBe('Routage des messages')
    expect(t(GAIN_PERIODS[0]!.labelKey)).toBe('Jour')

    configureLocale({ ECOTOKENS_PANEL_LANG: 'en' })
    expect(taskKindLabel('remote_agent')).toBe('Remote agent')
    expect(purposeLabel('router')).toBe('Message routing')
    expect(t(GAIN_PERIODS[0]!.labelKey)).toBe('Today')
  } finally {
    configureLocale({ ECOTOKENS_PANEL_LANG: previous })
  }
})

test('number, percentage, and USD formatters return localized strings', () => {
  expect(typeof formatNumber(12345)).toBe('string')
  expect(typeof formatPercent(1, 4)).toBe('string')
  expect(typeof formatUsd(1.25)).toBe('string')
})
