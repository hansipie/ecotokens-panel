import type { EcoJevCall, EcoLog, EcoSaving } from '../types'

// ecotokens keeps no session id: "this session" is every row since it started.
// Savings are also held to the session's project (their git_root); Jev calls carry none.

function quote(text: string) {
  return `'${text.replaceAll("'", "''")}'`
}

// What one query ran to: the command's argv, and later its JSON rows.
export type EcoQuery = { argv: string[] }

export type EcoQueries = { savings: EcoQuery; totals: EcoQuery; jev: EcoQuery }

function sqlite(db: string, sql: string): EcoQuery {
  return { argv: ['sqlite3', '-readonly', '-json', db, sql] }
}

// `sqlite3 -json` prints nothing at all for an empty result.
export function parseRows<T>(stdout: string): T[] {
  const out = stdout.trim()

  return out === '' ? [] : (JSON.parse(out) as T[])
}

const FAMILIES: Record<string, string> = {
  git: 'git',
  gh: 'GitHub CLI',
  cargo: 'Cargo',
  grep: 'recherche',
  fs: 'fichiers',
  python: 'Python',
  js: 'JS / npm',
  network: 'réseau',
  generic: 'shell',
}

const MODES: Record<string, string> = {
  filtered: 'Sortie filtrée (lignes inutiles retirées)',
  summarized: 'Sortie résumée',
  rewritten: 'Texte réécrit plus court',
}

function baseName(path: string) {
  return path.split('/').filter(Boolean).pop() ?? path
}

// Turns ecotokens' raw record into what a person reads: the object, then the means.
export function describeSaving(command: string, family: string, mode: string, before: number, after: number) {
  let what: string
  if (command.startsWith('Read ')) {
    what = `Lecture du fichier ${baseName(command.slice(5).trim())}`
  } else if (command.startsWith('hermes-tool:')) {
    what = `Outil Hermes ${command.slice(12)}`
  } else {
    // `bash -c cd <dir> && real command` reads as the real command.
    const shown = command.replace(/^bash -c\s+/, '').replace(/^cd\s+\S+\s*&&\s*/, '')
    what = `Commande ${FAMILIES[family] ?? family} : ${shown}`
  }
  const how = `${MODES[mode] ?? mode} · ${before} → ${after} tokens`

  return { what, how }
}

// The helper agents the router delegates to, and the model each runs on.
const AGENTS: Record<string, string> = {
  'router-tiny': 'Haiku',
  'router-everyday': 'Sonnet',
  'router-large': 'Opus',
  'router-hardest': 'Fable',
}

const SIZES: Record<string, string> = {
  tiny: 'très petit',
  everyday: 'courant',
  large: 'gros',
  hardest: 'très difficile',
}

export type JevDecision = { size: string | null; confidence: number | null; followup: number | null }

function prob(p: number | null) {
  return p === null ? '' : ` (p=${p.toFixed(2)})`
}

// Says what Jev was asked and what it decided, from the call and the router's own row.
export function describeJev(purpose: string, agent: string | null, ok: boolean, d: JevDecision | null) {
  if (purpose === 'filter_lines') {
    return {
      title: 'Filtrage IA d’une sortie trop longue',
      what: ok ? 'Jev a choisi les lignes utiles à garder' : 'Échec : la sortie a été filtrée sans Jev',
    }
  }
  if (purpose !== 'router') return { title: purpose, what: agent ?? '' }

  const sized = d?.size ? `Message jugé ${SIZES[d.size] ?? d.size}${prob(d.confidence)}` : 'Message évalué'
  if (!ok) return { title: 'Routage du message', what: 'Échec : traité par la session principale' }
  if (agent && AGENTS[agent]) {
    return { title: 'Routage du message', what: `${sized} → délégué à ${agent} (${AGENTS[agent]})` }
  }
  if (agent === 'self (followup)') {
    return {
      title: 'Routage du message',
      what: `${sized}, suite de conversation${prob(d?.followup ?? null)} → gardé par la session`,
    }
  }
  if (agent === 'self (unsure)') {
    return { title: 'Routage du message', what: `${sized}, trop incertain → gardé par la session` }
  }

  return { title: 'Routage du message', what: `${sized} → ${agent ?? 'gardé par la session'}` }
}

type SavingRow = {
  timestamp: string
  command: string
  command_family: string
  tokens_before: number
  tokens_after: number
  savings_pct: number
  mode: string
}

type TotalsRow = { saved: number | null; filtered: number }

type JevRow = {
  timestamp: string
  purpose: string
  agent: string | null
  ok: number
  error_kind: string | null
  http_status: number | null
  latency_ms: number
  input_tokens: number
  output_tokens: number
  size: string | null
  confidence: number | null
  followup_prob: number | null
}

export function ecoQueries(home: string, startedAt: number, sessionCwd: string): EcoQueries {
  const dir = `${home}/.config/ecotokens`
  const since = quote(new Date(startedAt).toISOString())
  const cwd = quote(sessionCwd)
  const inProject = `(git_root IS NULL OR git_root = ${cwd} OR ${cwd} LIKE git_root || '/%')`
  const saved = `timestamp >= ${since} AND tokens_after < tokens_before AND ${inProject}`

  return {
    savings: sqlite(
      `${dir}/metrics.db`,
      `SELECT timestamp, substr(replace(replace(command, char(10), ' '), char(13), ' '), 1, 200) AS command,
                command_family, tokens_before, tokens_after, savings_pct, mode
           FROM interceptions WHERE ${saved} ORDER BY timestamp DESC LIMIT 5`,
    ),
    totals: sqlite(
      `${dir}/metrics.db`,
      `SELECT sum(tokens_before - tokens_after) AS saved, count(*) AS filtered FROM interceptions WHERE ${saved}`,
    ),
    jev: sqlite(
      `${dir}/router.db`,
      // The router writes its decision a few ms before the call it made: the latest one within 5 s.
      `SELECT j.timestamp, j.purpose, j.agent, j.ok, j.error_kind, j.http_status, j.latency_ms,
              j.input_tokens, j.output_tokens, d.size, d.confidence, d.followup_prob
         FROM jev_calls j
         LEFT JOIN router_decisions d ON d.id = (
           SELECT id FROM router_decisions
            WHERE j.purpose = 'router' AND timestamp <= j.timestamp
              AND julianday(substr(j.timestamp, 1, 23)) - julianday(substr(timestamp, 1, 23)) < 5.0 / 86400
            ORDER BY id DESC LIMIT 1)
        WHERE j.timestamp >= ${since} ORDER BY j.id DESC LIMIT 5`,
    ),
  }
}

export function ecoLog(out: { savings: string; totals: string; jev: string }, now: number): EcoLog {
  const rows = parseRows<SavingRow>(out.savings)
  const totals = parseRows<TotalsRow>(out.totals)
  const jev = parseRows<JevRow>(out.jev)
  const savings: EcoSaving[] = rows.map(r => ({
    at: r.timestamp,
    command: r.command,
    family: r.command_family,
    before: r.tokens_before,
    after: r.tokens_after,
    pct: r.savings_pct,
    mode: r.mode,
    ...describeSaving(r.command, r.command_family, r.mode, r.tokens_before, r.tokens_after),
  }))
  const calls: EcoJevCall[] = jev.map(r => ({
    at: r.timestamp,
    purpose: r.purpose,
    agent: r.agent ?? undefined,
    ok: r.ok === 1,
    error: r.ok === 1 ? undefined : [r.error_kind, r.http_status].filter(x => x !== null).join(' ') || 'échec',
    latencyMs: r.latency_ms,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    ...describeJev(
      r.purpose,
      r.agent,
      r.ok === 1,
      r.size === null && r.confidence === null
        ? null
        : { size: r.size, confidence: r.confidence, followup: r.followup_prob },
    ),
  }))

  return {
    savings,
    jev: calls,
    totalSaved: totals[0]?.saved ?? 0,
    totalFiltered: totals[0]?.filtered ?? 0,
    measuredAt: now,
  }
}

export function ecoError(error: unknown, now: number): EcoLog {
  return {
    savings: [],
    jev: [],
    totalSaved: 0,
    totalFiltered: 0,
    error: error instanceof Error ? error.message : String(error),
    measuredAt: now,
  }
}
