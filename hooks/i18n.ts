import { en } from '../locales/en'
import { fr } from '../locales/fr'
import { hi } from '../locales/hi'

export type Locale = 'en' | 'fr' | 'hi'
type EnglishCatalog = typeof en
type Catalog = {
  [K in keyof EnglishCatalog]: EnglishCatalog[K] extends string ? string : { one: string; other: string }
}
type MessageKey = keyof EnglishCatalog
type StringKey = {
  [K in MessageKey]: EnglishCatalog[K] extends string ? K : never
}[MessageKey]
type PluralKey = {
  [K in MessageKey]: EnglishCatalog[K] extends { one: string; other: string } ? K : never
}[MessageKey]
type Values = Record<string, string | number>

const catalogs: Record<Locale, Catalog> = { en, fr, hi }
const availableLocales: Locale[] = ['en', 'fr', 'hi']

function supportedLanguage(value?: string): Locale | undefined {
  if (!value) return undefined
  const normalized = (value.trim().split(':')[0] ?? '').replace(/[.@].*$/, '').replaceAll('_', '-')
  if (!normalized) return undefined

  try {
    const language = Intl.getCanonicalLocales(normalized)[0]?.split('-')[0].toLowerCase()

    return availableLocales.find(locale => locale === language)
  } catch {
    return undefined
  }
}

export function resolveLocale(explicit?: string, system?: string): Locale {
  return supportedLanguage(explicit) ?? supportedLanguage(system) ?? 'en'
}

type RuntimeWithEnv = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> }
}

function environmentLocale(env: Record<string, string | undefined>) {
  return [env.LC_ALL, env.LC_MESSAGES, env.LANG, env.LANGUAGE]
    .map(supportedLanguage)
    .find((value): value is Locale => value !== undefined)
}

function systemLocale(env: Record<string, string | undefined>) {
  const detected = environmentLocale(env)
  let intlLocale: string | undefined
  try {
    intlLocale = Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    // The English fallback still works in runtimes without locale data.
  }

  return detected ?? supportedLanguage(intlLocale) ?? 'en'
}

export let locale: Locale = 'en'

export function configureLocale(env: Record<string, string | undefined>) {
  const detected = supportedLanguage(env.ECOTOKENS_PANEL_LANG) ?? environmentLocale(env)
  locale = detected ?? systemLocale(env)

  return locale
}

configureLocale((globalThis as RuntimeWithEnv).process?.env ?? {})

function interpolate(template: string, values: Values = {}) {
  return template.replace(/\{([\w.]+)\}/g, (placeholder, name: string) => {
    const value = values[name]

    return value === undefined ? placeholder : String(value)
  })
}

export function t(key: StringKey, values?: Values): string {
  const selected = catalogs[locale][key]
  const fallback = catalogs.en[key]

  return interpolate(typeof selected === 'string' ? selected : typeof fallback === 'string' ? fallback : String(key), values)
}

export function tp(key: PluralKey, count: number, values: Values = {}): string {
  const selected = catalogs[locale][key]
  const fallback = catalogs.en[key]
  const rule = new Intl.PluralRules(locale).select(count)
  const category = rule as 'one' | 'other'
  const template = typeof selected === 'string' ? selected : selected?.[category] ?? selected?.other
  const fallbackTemplate = typeof fallback === 'string' ? fallback : fallback?.[category] ?? fallback?.other

  return interpolate(template ?? fallbackTemplate ?? String(key), { ...values, count: formatNumber(count) })
}

export function formatNumber(value: number, maximumFractionDigits = 0, minimumFractionDigits = 0) {
  if (!Number.isFinite(value)) return String(value)

  return new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits }).format(value)
}

export function formatInteger(value: number, minimumIntegerDigits = 1) {
  if (!Number.isFinite(value)) return String(value)

  return new Intl.NumberFormat(locale, { useGrouping: false, minimumIntegerDigits, maximumFractionDigits: 0 }).format(value)
}

export function formatPercent(part: number, whole: number, maximumFractionDigits = 1) {
  if (!(whole > 0)) return ''

  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits }).format(part / whole)
}

export function formatUsd(value: number, fractionDigits = 2) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

export function formatClock(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date)
}
