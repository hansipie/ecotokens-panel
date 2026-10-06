import type { GainPeriod, GainReport, GainRow, JevPurpose, JevReport } from '../types'

// `ecotokens gain` and `ecotokens jev` report over a period, held to one project with --project
// (a directory inside it: ecotokens keys projects by git root).
export const GAIN_PERIODS: { id: GainPeriod; label: string }[] = [
  { id: 'today', label: 'Jour' },
  { id: 'week', label: 'Semaine' },
  { id: 'month', label: 'Mois' },
  { id: 'all', label: 'Tout' },
]

export function gainCommand(period: GainPeriod, project: string) {
  return ['ecotokens', 'gain', '--period', period, '--project', project, '--json']
}

export function jevCommand(period: GainPeriod, project: string) {
  return ['ecotokens', 'jev', '--period', period, '--project', project, '--json']
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function object(stdout: string, what: string) {
  const j = JSON.parse(stdout) as unknown
  if (typeof j !== 'object' || j === null || Array.isArray(j)) throw new Error(`réponse inattendue de ecotokens ${what}`)

  return j as Record<string, unknown>
}

type RowJson = { count?: unknown; tokens_before?: unknown; tokens_after?: unknown }

// The biggest savings first.
function rows(map: unknown): GainRow[] {
  if (typeof map !== 'object' || map === null) return []

  return Object.entries(map as Record<string, RowJson>)
    .map(([name, r]) => ({ name, count: num(r?.count), before: num(r?.tokens_before), after: num(r?.tokens_after) }))
    .sort((x, y) => y.before - y.after - (x.before - x.after))
}

export function parseGain(stdout: string): GainReport {
  const j = object(stdout, 'gain')

  return {
    interceptions: num(j.total_interceptions),
    before: num(j.total_tokens_before),
    after: num(j.total_tokens_after),
    savingsPct: num(j.total_savings_pct),
    costAvoidedUsd: num(j.cost_avoided_usd),
    families: rows(j.by_family),
  }
}

type PurposeJson = { calls?: unknown; ok?: unknown; input_tokens?: unknown; output_tokens?: unknown; avg_latency_ms?: unknown }

export function parseJev(stdout: string): JevReport {
  const j = object(stdout, 'jev')
  const purposes: JevPurpose[] = Object.entries((j.by_purpose ?? {}) as Record<string, PurposeJson>)
    .map(([name, p]) => ({
      name,
      calls: num(p?.calls),
      ok: num(p?.ok),
      inputTokens: num(p?.input_tokens),
      outputTokens: num(p?.output_tokens),
      avgLatencyMs: num(p?.avg_latency_ms),
    }))
    .filter(p => p.calls > 0)
    .sort((x, y) => y.calls - x.calls)
  const errors = Object.entries((j.errors ?? {}) as Record<string, unknown>)
    .map(([kind, count]) => ({ kind, count: num(count) }))
    .filter(e => e.count > 0)
    .sort((x, y) => y.count - x.count)

  return {
    calls: num(j.calls),
    ok: num(j.ok),
    fallbacks: num(j.fallbacks),
    inputTokens: num(j.input_tokens),
    outputTokens: num(j.output_tokens),
    costUsd: num(j.cost_usd),
    avgLatencyMs: num(j.avg_latency_ms),
    p95LatencyMs: num(j.p95_latency_ms),
    purposes,
    errors,
    timeline: Array.isArray(j.timeline) ? j.timeline.map(num) : [],
  }
}

const BARS = '▁▂▃▄▅▆▇█'

// One glyph per bucket, the last `width` buckets; an empty bucket is the lowest bar.
export function sparkline(values: number[], width: number) {
  const shown = values.slice(-Math.max(1, width))
  const max = Math.max(0, ...shown)
  if (max === 0) return BARS[0]!.repeat(shown.length)

  return shown.map(v => BARS[Math.min(BARS.length - 1, Math.round((v / max) * (BARS.length - 1)))]).join('')
}

// What Jev was asked to do, in the panel's words.
export const PURPOSE_LABELS: Record<string, string> = {
  router: 'Routage des messages',
  filter_lines: 'Filtrage de sorties',
  classify: 'Classification',
  code_gate: 'Contrôle de code',
  verify: 'Vérification',
  other: 'Autre',
}
