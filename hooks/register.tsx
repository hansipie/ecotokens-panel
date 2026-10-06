import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextBreakdown, SessionUsage } from 'claude-code'

import type { ContextDetail, EcoLog, GainPeriod, GainState, HandoffState, TabId, UsageSnapshot, WatchState } from '../types'
import { cells, gradient } from './bar'
import { ecoError, ecoLog, ecoQueries } from './eco'
import type { EcoQuery } from './eco'
import { GAIN_PERIODS, PURPOSE_LABELS, gainCommand, jevCommand, parseGain, parseJev, sparkline } from './gain'
import { HANDOFF_LIST, HANDOFF_STATUS, handoffToggle, parseHandoff, parseHandoffList } from './handoff'
import { WATCH_STATUS, parseLogTail, parseWatch, watchLogTail, watchStart, watchStop } from './watch'

const PANE = 'ecotokens-panel'
const TITLE = 'ecotokens-panel'
const PANE_COLUMNS = 44

const tab = atom({ plugin: 'ecotokens-panel', key: 'tab' } as const, 'session' as TabId)
const usage = atom({ plugin: 'ecotokens-panel', key: 'usage' } as const, null as UsageSnapshot | null)
const context = atom({ plugin: 'ecotokens-panel', key: 'context' } as const, null as ContextDetail | null)
const eco = atom({ plugin: 'ecotokens-panel', key: 'eco' } as const, null as EcoLog | null)
const handoff = atom({ plugin: 'ecotokens-panel', key: 'handoff' } as const, null as HandoffState | null)
const gainPeriod = atom({ plugin: 'ecotokens-panel', key: 'gainPeriod' } as const, 'today' as GainPeriod)
const gain = atom({ plugin: 'ecotokens-panel', key: 'gain' } as const, null as GainState | null)
const watch = atom({ plugin: 'ecotokens-panel', key: 'watch' } as const, null as WatchState | null)

// Add a tab here, then a case in drawTab().
const TABS: { id: TabId; label: string }[] = [
  { id: 'session', label: 'Session' },
  { id: 'context', label: 'Contexte' },
  { id: 'eco', label: 'Ecotokens' },
  { id: 'gain', label: 'Gains' },
  { id: 'watch', label: 'Watch' },
]

const WINDOW_LABELS: Record<string, string> = {
  five_hour: 'Session (5 h)',
  seven_day: 'Semaine (7 j)',
  spend_limit: 'Plafond de dépense',
}

function snapshot(u: SessionUsage, now: number): UsageSnapshot {
  return {
    contextTokens: u.context.tokens,
    contextWindow: u.context.window,
    contextPercent: u.context.percent,
    rateLimits: u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
    costUsd: u.cost?.usd,
    measuredAt: now,
  }
}

function detail(b: SessionContextBreakdown, now: number): ContextDetail {
  const servers = new Map<string, { server: string; tools: number; loaded: number; tokens: number }>()
  for (const t of b.mcpTools) {
    const s = servers.get(t.serverName) ?? { server: t.serverName, tools: 0, loaded: 0, tokens: 0 }
    s.tools += 1
    if (t.isLoaded) {
      s.loaded += 1
      s.tokens += t.tokens
    }
    servers.set(t.serverName, s)
  }

  return {
    model: b.model,
    totalTokens: b.totalTokens,
    maxTokens: b.rawMaxTokens,
    percentage: b.percentage,
    isAutoCompactEnabled: b.isAutoCompactEnabled,
    autoCompactThreshold: b.autoCompactThreshold,
    categories: b.categories.map(c => ({ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind })),
    grid: b.gridRows.map(row => row.map(q => ({ color: q.color, isFilled: q.isFilled, fullness: q.squareFullness }))),
    memoryFiles: [...b.memoryFiles].sort((x, y) => y.tokens - x.tokens).map(f => ({ path: f.path, type: f.type, tokens: f.tokens })),
    mcpServers: [...servers.values()].sort((x, y) => y.tokens - x.tokens),
    skills: b.skills && { total: b.skills.totalSkills, included: b.skills.includedSkills, tokens: b.skills.tokens },
    agents: { count: b.agents.length, tokens: b.agents.reduce((sum, a) => sum + a.tokens, 0) },
    api: b.apiUsage && {
      input: b.apiUsage.input_tokens,
      cacheRead: b.apiUsage.cache_read_input_tokens,
      cacheWrite: b.apiUsage.cache_creation_input_tokens,
      output: b.apiUsage.output_tokens,
    },
    measuredAt: now,
  }
}

// `summary` estimates locally, as /context's quick view: no token-count requests.
async function refresh($: EngineInterface) {
  const u = await $.session.usage({ breakdown: 'summary' })
  const now = await $.clock.now()
  await update($, usage, () => snapshot(u, now))
  const b = u.context.breakdown
  if (b) await update($, context, () => detail(b, now))
  await refreshEco($)
  await refreshHandoff($)
  await refreshWatch($)
}

async function runQuery($: EngineInterface, q: EcoQuery) {
  const ran = await $.process.run(q.argv, { timeoutMs: 5_000 })
  if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `sqlite3 a échoué (${ran.exitCode})`)

  return ran.stdout
}

async function refreshEco($: EngineInterface) {
  let log: EcoLog
  try {
    const { startedAt } = await $.session.usage()
    const home = (await $.env.get('HOME')) ?? ''
    const q = ecoQueries(home, startedAt, await $.session.cwd())
    const [savings, totals, jev] = await Promise.all([
      runQuery($, q.savings),
      runQuery($, q.totals),
      runQuery($, q.jev),
    ])
    log = ecoLog({ savings, totals, jev }, await $.clock.now())
  } catch (error) {
    log = ecoError(error, await $.clock.now())
  }
  await update($, eco, () => log)
}

// The handoff panel is a bonus too: without ecotokens it just says so.
async function refreshHandoff($: EngineInterface) {
  let state: HandoffState | null = null
  try {
    const ran = await $.process.run(HANDOFF_STATUS, { timeoutMs: 5_000 })
    if (ran.exitCode === 0) state = parseHandoff(ran.stdout, await $.clock.now())
    if (state) {
      // The list is a bonus of the bonus: without it the status still shows.
      try {
        const cwd = await $.session.cwd()
        const listed = await $.process.run(HANDOFF_LIST, { cwd, timeoutMs: 5_000 })
        if (listed.exitCode === 0) state = { ...state, entries: parseHandoffList(listed.stdout, cwd) }
      } catch {
        // entries stay empty
      }
    }
  } catch {
    // Left empty: the panel shows that the state could not be read.
  }
  await update($, handoff, () => state)
}

async function runHandoff($: EngineInterface, argv: string[], done: string) {
  try {
    const ran = await $.process.run(argv, { timeoutMs: 15_000 })
    $.ui.toast(ran.exitCode === 0 ? done : `handoff : ${ran.stderr.trim() || `échec (${ran.exitCode})`}`)
  } catch (error) {
    $.ui.toast(`handoff : ${error instanceof Error ? error.message : String(error)}`)
  }
  await refreshHandoff($)
}

// Runs the /handoff skill as if typed: it writes the handoff, then has the model fill its fields.
// The turn it starts is the model's; the status is read again when it completes.
async function runHandoffSkill($: EngineInterface) {
  try {
    await $.command.run({ command: 'handoff', args: '' })
    $.ui.toast('/handoff lancé : la session prépare le handoff.')
  } catch (error) {
    $.ui.toast(`handoff : ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function report<T>($: EngineInterface, argv: string[], parse: (stdout: string) => T) {
  const ran = await $.process.run(argv, { timeoutMs: 10_000 })
  if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `${argv.slice(0, 2).join(' ')} a échoué (${ran.exitCode})`)

  return parse(ran.stdout)
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

// `ecotokens gain` and `ecotokens jev` over the chosen period, for this workspace only, each on its own.
async function refreshGain($: EngineInterface) {
  const period = await read($, gainPeriod)
  const project = await $.session.cwd()
  const [g, j] = await Promise.allSettled([
    report($, gainCommand(period, project), parseGain),
    report($, jevCommand(period, project), parseJev),
  ])
  const state: GainState = {
    period,
    project,
    gain: g.status === 'fulfilled' ? g.value : undefined,
    gainError: g.status === 'rejected' ? message(g.reason) : undefined,
    jev: j.status === 'fulfilled' ? j.value : undefined,
    jevError: j.status === 'rejected' ? message(j.reason) : undefined,
    measuredAt: await $.clock.now(),
  }
  await update($, gain, () => state)
}

// The watch tab is a bonus too: without ecotokens it says the state could not be read.
async function refreshWatch($: EngineInterface) {
  let state: WatchState | null = null
  try {
    const cwd = await $.session.cwd()
    const ran = await $.process.run(WATCH_STATUS, { timeoutMs: 5_000 })
    state = parseWatch(ran.stdout, ran.exitCode === 0, cwd, await $.clock.now())
    const logFile = state.current?.logFile
    if (logFile) {
      try {
        const tail = await $.process.run(watchLogTail(logFile), { timeoutMs: 5_000 })
        if (tail.exitCode === 0) state = { ...state, log: parseLogTail(tail.stdout) }
      } catch {
        // log stays empty
      }
    }
  } catch {
    // Left empty: the tab shows that the state could not be read.
  }
  await update($, watch, () => state)
}

// The daemon registers itself just after `--background` returns: wait a moment before reading.
async function runWatch($: EngineInterface, start: boolean) {
  try {
    const cwd = await $.session.cwd()
    const ran = await $.process.run(start ? watchStart(cwd) : watchStop(cwd), { cwd, timeoutMs: 15_000 })
    $.ui.toast(
      ran.exitCode === 0
        ? start
          ? 'Watch démarré.'
          : 'Watch arrêté.'
        : `watch : ${ran.stderr.trim() || `échec (${ran.exitCode})`}`,
    )
    if (start && ran.exitCode === 0) await $.clock.sleep(800)
  } catch (error) {
    $.ui.toast(`watch : ${error instanceof Error ? error.message : String(error)}`)
  }
  await refreshWatch($)
}

// Reads ecotokens' databases only while its tab is the one on screen.
async function refreshEcoIfShown($: EngineInterface) {
  if ((await read($, tab)) === 'eco' && (await isPaneOpen($))) await refreshEco($)
}

async function isPaneOpen($: EngineInterface) {
  return (await $.ui.panes()).some(p => p.id === PANE)
}

async function toggle($: EngineInterface) {
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })
    return
  }
  await refresh($)
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
  if (!opened.isPlaced) $.ui.toast(`ecotokens-panel : ${opened.reason}`)
}

function levelColor(percent: number) {
  return gradient(percent / 100)
}

function kTokens(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n)
}

function pct(part: number, whole: number) {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : ''
}

function shortPath(path: string) {
  return path.replace(/^\/var\/home\/[^/]+|^\/home\/[^/]+/, '~')
}

// The glyphs /context draws: full, partly full, empty.
function square(fullness: number, isFilled: boolean) {
  if (!isFilled) return '⛶'
  return fullness >= 0.7 ? '⛁' : '⛀'
}

// ecotokens stamps nanoseconds; Date reads milliseconds.
function clock(iso: string) {
  const d = new Date(iso.replace(/(\.\d{3})\d+/, '$1'))
  const two = (n: number) => String(n).padStart(2, '0')

  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

function ageLabel(hours: number) {
  return hours < 1 ? 'il y a < 1 h' : hours < 48 ? `il y a ${hours} h` : `il y a ${Math.floor(hours / 24)} j`
}

function untilReset(resetsAt: string | undefined, now: number) {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (!(ms > 0)) return 'réinitialisation imminente'
  const min = Math.round(ms / 60_000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  const parts = d > 0 ? `${d} j ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`
  return `réinit. dans ${parts}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'panel',
      description: 'Ouvre ou ferme le panneau ecotokens-panel (contexte, quota)',
    })
    await refresh($)

    return next(e)
  })

  on('command.run', { command: 'panel' }, async $ => {
    await toggle($)

    return { text: 'Panneau ecotokens-panel basculé.' }
  })

  // Keep the figures fresh: the engine raises this whenever context, quota or cost moves.
  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, usage, () =>
      snapshot({ startedAt: 0, context: e.context, rateLimits: e.rateLimits, cost: e.cost }, now),
    )
    // The breakdown costs a local estimate: only while someone can see it.
    if (e.changed.includes('context') && (await isPaneOpen($))) await refresh($)

    return next(e)
  })

  // ecotokens writes its rows from the tool hooks and the prompt router.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    await refreshEcoIfShown($)

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refreshEcoIfShown($)
    const shown = await read($, tab)
    if (shown === 'session' && (await isPaneOpen($))) await refreshHandoff($)
    if (shown === 'watch' && (await isPaneOpen($))) await refreshWatch($)
    if (shown === 'gain' && (await isPaneOpen($))) await refreshGain($)

    return done
  })

  // The footer button, beside the engine's own mode labels.
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const modes = e.props.modes

    return (
      <Box flexDirection="row" gap={1}>
        {modes.length > 0 && <Text dimColor>{modes.join(' & ')}</Text>}
        <Button key="toggle" plain dimColor label="◧ ecotokens-panel" onPress={() => void toggle($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = await read($, tab)
    const u = await read($, usage)
    const c = await read($, context)
    const log = await read($, eco)
    const handoffState = await read($, handoff)
    const watchState = await read($, watch)
    const gainState = await read($, gain)
    const sessionId = await $.session.id()
    const now = await $.clock.now()
    const width = Math.max(10, e.props.bodyColumns - 2)
    const barWidth = Math.max(8, width - 8)

    const tabBar = (
      <Box flexDirection="row" gap={1}>
        {TABS.map((t, i) => (
          <Button
            key={`tab-${t.id}`}
            hotkey={String(i + 1)}
            variant={t.id === current ? 'primary' : 'secondary'}
            label={t.label}
            onPress={async () => {
              await update($, tab, () => t.id)
              if (t.id === 'eco') await refreshEco($)
              if (t.id === 'watch') await refreshWatch($)
              if (t.id === 'gain') await refreshGain($)
            }}
          />
        ))}
        <Box flexGrow={1} />
        <Button
          key="refresh"
          plain
          dimColor
          label="↻"
          onPress={async () => {
            await refresh($)
            if (current === 'gain') await refreshGain($)
          }}
        />
        <Button key="close" role="dismiss" plain dimColor label="✕" onPress={() => void $.ui.close({ id: PANE })} />
      </Box>
    )

    const meter = (label: string, percent: number | undefined, detail: string) => (
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>{label}</Text>
          <Text color={percent === undefined ? undefined : levelColor(percent)}>
            {percent === undefined ? '—' : `${percent}%`}
          </Text>
        </Box>
        <Box flexDirection="row">
          {cells(percent ?? 0, barWidth).map(c =>
            c.isFilled ? <Text color={c.color}>━</Text> : <Text dimColor>─</Text>,
          )}
        </Box>
        {detail !== '' && <Text dimColor>{detail}</Text>}
      </Box>
    )

    const usageSection = () => {
      if (!u) return <Text dimColor>Aucune mesure pour l'instant.</Text>
      const ctxDetail =
        u.contextTokens === undefined
          ? `fenêtre de ${kTokens(u.contextWindow)} tokens, pas encore de réponse`
          : `${kTokens(u.contextTokens)} / ${kTokens(u.contextWindow)} tokens`

      return (
        <Box flexDirection="column">
          <Text color="claude" bold>
            Fenêtre de contexte
          </Text>
          {meter('Utilisé', u.contextPercent, ctxDetail)}

          <Text color="claude" bold>
            Quota de l'abonnement
          </Text>
          {u.rateLimits.length === 0 ? (
            <Box marginBottom={1}>
              <Text dimColor>Pas encore de relevé (il arrive avec la prochaine réponse du modèle).</Text>
            </Box>
          ) : (
            u.rateLimits.map(r =>
              meter(WINDOW_LABELS[r.kind] ?? r.kind, r.percentUsed, untilReset(r.resetsAt, now)),
            )
          )}

          {u.costUsd !== undefined && (
            <Text dimColor>Coût équivalent API : ${u.costUsd.toFixed(2)}</Text>
          )}
        </Box>
      )
    }

    // `h` is the JSX factory (tsconfig `jsxFactory`): never name a variable `h` where JSX is drawn.
    const handoffPanel = () => {
      const hs = handoffState
      if (!hs) return <Text dimColor>Handoff : état illisible (ecotokens est-il installé ?).</Text>
      const setup = hs.hookInstalled && hs.skillsInstalled ? 'hook et skills en place' : 'installation incomplète'

      return (
        <Box flexDirection="column">
          {line('État', hs.enabled ? 'activé' : 'désactivé', hs.enabled ? 'success' : undefined)}
          <Text dimColor>{setup}</Text>
          {line('Ici', `${hs.pending} en attente · ${hs.consumed} repris`)}
          <Text dimColor>
            Périmé après {hs.staleHours} h · {hs.maxChars} car. max · gardé {hs.retentionDays} j · {hs.injections} injection
            {hs.injections > 1 ? 's' : ''}
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {hs.entries.length === 0 ? (
              <Text dimColor>Aucun handoff enregistré.</Text>
            ) : (
              hs.entries.map(en => (
                <Box flexDirection="column">
                  {line(
                    `${en.id.slice(0, 8)}${en.id === sessionId ? ' (cette session)' : ''}`,
                    `${ageLabel(en.ageHours)} · ${en.status}${en.stale ? ' (périmé)' : ''}`,
                    en.status === 'pending' ? 'success' : undefined,
                    en.status !== 'pending',
                  )}
                  <Text dimColor wrap="truncate-end">
                    {en.objective || '—'}
                  </Text>
                </Box>
              ))
            )}
          </Box>
          <Box flexDirection="row" gap={1}>
            <Button
              key="handoff-toggle"
              hotkey="h"
              variant={hs.enabled ? 'secondary' : 'primary'}
              label={hs.enabled ? 'Désactiver' : 'Activer'}
              onPress={() =>
                void runHandoff(
                  $,
                  handoffToggle(!hs.enabled),
                  hs.enabled ? 'Handoff désactivé.' : 'Handoff activé.',
                )
              }
            />
            <Button
              key="handoff-write"
              variant="secondary"
              label="Handoff (/handoff)"
              onPress={() => void runHandoffSkill($)}
            />
          </Box>
        </Box>
      )
    }

    // The handoff panel is a bonus: if it cannot be drawn, the rest of the tab still is.
    const safeHandoffPanel = () => {
      try {
        return handoffPanel()
      } catch {
        return <Text dimColor>Handoff : affichage impossible.</Text>
      }
    }

    const sessionTab = () => (
      <Box flexDirection="column" gap={1}>
        {usageSection()}
        <Box flexDirection="column">
          {section('Handoff')}
          {safeHandoffPanel()}
        </Box>
      </Box>
    )

    const section = (title: string) => (
      <Text color="claude" bold>
        {title}
      </Text>
    )

    const line = (label: string, value: string, color?: string, dim?: boolean) => (
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={color} dimColor={dim} wrap="truncate-end">
          {label}
        </Text>
        <Text dimColor={dim}>{value}</Text>
      </Box>
    )

    const contextTab = () => {
      if (!c) return <Text dimColor>Pas encore de détail : appuyez sur ↻.</Text>
      const used = c.categories.filter(r => r.kind === 'used')
      const reserved = c.categories.filter(r => r.kind !== 'used' && r.kind !== 'deferred')
      const deferred = c.categories.filter(r => r.kind === 'deferred')
      const toCompact =
        c.isAutoCompactEnabled && c.autoCompactThreshold !== undefined
          ? Math.max(0, c.autoCompactThreshold - c.totalTokens)
          : undefined

      return (
        <Box flexDirection="column">
          {meter(c.model, c.percentage, `${kTokens(c.totalTokens)} / ${kTokens(c.maxTokens)} tokens`)}
          <Box marginBottom={1}>
            <Text dimColor>
              {toCompact === undefined
                ? 'Auto-compactage désactivé'
                : `Auto-compactage à ${kTokens(c.autoCompactThreshold ?? 0)} · encore ${kTokens(toCompact)}`}
            </Text>
          </Box>

          <Box flexDirection="column" marginBottom={1}>
            {c.grid.map(row => (
              <Box flexDirection="row" gap={1}>
                {row.map(q => (
                  <Text color={q.color} dimColor={!q.isFilled}>
                    {square(q.fullness, q.isFilled)}
                  </Text>
                ))}
              </Box>
            ))}
          </Box>

          {section('Répartition')}
          <Box flexDirection="column" marginBottom={1}>
            {[...used, ...reserved].map(r =>
              line(`● ${r.name}`, `${kTokens(r.tokens)} · ${pct(r.tokens, c.maxTokens)}`, r.color, r.kind !== 'used'),
            )}
            {deferred.map(r => line(`○ ${r.name} (à la demande)`, kTokens(r.tokens), undefined, true))}
          </Box>

          {c.api && (
            <Box flexDirection="column" marginBottom={1}>
              {section('Dernière requête')}
              {line('Lu depuis le cache', kTokens(c.api.cacheRead))}
              {line('Écrit en cache', kTokens(c.api.cacheWrite))}
              {line('Entrée hors cache', kTokens(c.api.input))}
              {line('Sortie', kTokens(c.api.output))}
            </Box>
          )}

          {c.memoryFiles.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              {section('Fichiers mémoire')}
              {c.memoryFiles.slice(0, 8).map(f => line(shortPath(f.path), kTokens(f.tokens)))}
            </Box>
          )}

          {c.mcpServers.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              {section('Serveurs MCP')}
              {c.mcpServers.map(s =>
                line(`${s.server} (${s.loaded}/${s.tools} outils)`, s.loaded > 0 ? kTokens(s.tokens) : '—', undefined, s.loaded === 0),
              )}
            </Box>
          )}

          <Box flexDirection="column">
            {section('Autres')}
            {c.skills && line(`Skills (${c.skills.included}/${c.skills.total} listés)`, kTokens(c.skills.tokens))}
            {c.agents.count > 0 && line(`Agents (${c.agents.count})`, kTokens(c.agents.tokens))}
          </Box>
        </Box>
      )
    }

    const ecoTab = () => {
      if (!log) return <Text dimColor>Pas encore de relevé : appuyez sur ↻.</Text>
      if (log.error) return <Text color="error">Lecture impossible : {log.error}</Text>

      return (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text dimColor>
              Session : {kTokens(log.totalSaved)} tokens économisés sur {log.totalFiltered} sorties filtrées
            </Text>
          </Box>

          {section('5 dernières économies')}
          <Box flexDirection="column" marginBottom={1}>
            {log.savings.length === 0 && <Text dimColor>Aucune pour l'instant.</Text>}
            {log.savings.map(g => (
              <Box flexDirection="column" marginBottom={1}>
                {line(`−${kTokens(g.before - g.after)} tokens (${Math.round(g.pct)}%)`, clock(g.at), 'success')}
                <Text wrap="truncate-end">{g.what}</Text>
                <Text dimColor wrap="truncate-end">
                  {g.how}
                </Text>
              </Box>
            ))}
          </Box>

          {section('5 derniers appels à Jev')}
          <Box flexDirection="column">
            {log.jev.length === 0 && <Text dimColor>Aucun pour l'instant.</Text>}
            {log.jev.map(j => (
              <Box flexDirection="column" marginBottom={1}>
                {line(`${j.ok ? '✓' : '✗'} ${j.title}`, clock(j.at), j.ok ? 'success' : 'error')}
                <Text wrap="truncate-end">{j.what}</Text>
                <Text dimColor wrap="truncate-end">
                  {j.error ? `${j.error} · ` : ''}
                  {j.latencyMs} ms · coût Jev {kTokens(j.inputTokens)} → {kTokens(j.outputTokens)} tokens
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )
    }

    const gainRow = (r: { name: string; count: number; before: number; after: number }, label: string) =>
      line(label, `−${kTokens(r.before - r.after)} · ${pct(r.before - r.after, r.before)} · ${r.count}×`)

    const gainTab = () => {
      const gs = gainState
      const period = gs?.period ?? 'today'
      const periods = (
        <Box flexDirection="row" gap={1}>
          {GAIN_PERIODS.map(p => (
            <Button
              key={`period-${p.id}`}
              variant={p.id === period ? 'primary' : 'secondary'}
              label={p.label}
              onPress={async () => {
                await update($, gainPeriod, () => p.id)
                await refreshGain($)
              }}
            />
          ))}
        </Box>
      )
      if (!gs) return <Box flexDirection="column" gap={1}>{periods}<Text dimColor>Pas encore de relevé : appuyez sur ↻.</Text></Box>
      const g = gs.gain
      const j = gs.jev

      return (
        <Box flexDirection="column" gap={1}>
          {periods}
          {gs.project && (
            <Text dimColor wrap="truncate-start">
              Workspace : {shortPath(gs.project)}
            </Text>
          )}

          <Box flexDirection="column">
            {section('Gains (ecotokens gain)')}
            {gs.gainError && <Text color="error">Lecture impossible : {gs.gainError}</Text>}
            {g && (
              <Box flexDirection="column">
                {meter('Tokens économisés', Math.round(g.savingsPct), `${kTokens(g.before - g.after)} sur ${kTokens(g.before)} · ${g.interceptions} sorties`)}
                <Text dimColor>Coût évité : ${g.costAvoidedUsd.toFixed(2)}</Text>
                {g.families.length > 0 && (
                  <Box flexDirection="column" marginTop={1}>
                    <Text bold>Par famille</Text>
                    {g.families.slice(0, 6).map(r => gainRow(r, r.name))}
                  </Box>
                )}
              </Box>
            )}
          </Box>

          <Box flexDirection="column">
            {section('Jev (ecotokens jev)')}
            {gs.jevError && <Text color="error">Lecture impossible : {gs.jevError}</Text>}
            {j && (
              <Box flexDirection="column">
                {line('Appels', `${j.calls} · ${j.ok} réussis · ${j.fallbacks} repli${j.fallbacks > 1 ? 's' : ''}`, j.ok < j.calls ? 'warning' : undefined)}
                {line('Coût', `$${j.costUsd.toFixed(4)} · ${kTokens(j.inputTokens)} → ${kTokens(j.outputTokens)}`)}
                {line('Latence', `moy. ${j.avgLatencyMs} ms · p95 ${j.p95LatencyMs} ms`)}
                {j.timeline.length > 0 && (
                  <Text color="claude" wrap="truncate-start">
                    {sparkline(j.timeline, width)}
                  </Text>
                )}
                {j.purposes.length > 0 && (
                  <Box flexDirection="column" marginTop={1}>
                    <Text bold>Par usage</Text>
                    {j.purposes.map(p =>
                      line(
                        PURPOSE_LABELS[p.name] ?? p.name,
                        `${p.calls}× · ${p.avgLatencyMs} ms`,
                        p.ok < p.calls ? 'warning' : undefined,
                      ),
                    )}
                  </Box>
                )}
                {j.errors.length > 0 && (
                  <Box flexDirection="column" marginTop={1}>
                    <Text bold>Erreurs</Text>
                    {j.errors.map(e => line(e.kind, `${e.count}×`, 'error'))}
                  </Box>
                )}
              </Box>
            )}
          </Box>
        </Box>
      )
    }

    const watchTab = () => {
      const ws = watchState
      if (!ws) return <Text dimColor>Watch : état illisible (ecotokens est-il installé ?).</Text>
      const cur = ws.current

      return (
        <Box flexDirection="column">
          {section('Ce dossier')}
          <Text dimColor wrap="truncate-start">
            {shortPath(ws.cwd)}
          </Text>
          {line('État', cur ? 'en cours' : 'arrêté', cur ? 'success' : undefined)}
          {cur && (
            <Text dimColor>
              PID {cur.pid} · {cur.sessions} session{cur.sessions > 1 ? 's' : ''}
              {cur.startedAt ? ` · depuis ${clock(cur.startedAt)}` : ''}
            </Text>
          )}
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Button
              key="watch-toggle"
              hotkey="w"
              variant={cur ? 'secondary' : 'primary'}
              label={cur ? 'Arrêter' : 'Démarrer'}
              onPress={() => void runWatch($, !cur)}
            />
          </Box>

          {cur && (
            <Box flexDirection="column" marginTop={1}>
              {section('Journal')}
              {ws.log.length === 0 ? (
                <Text dimColor>Rien pour l'instant.</Text>
              ) : (
                ws.log.map(l => (
                  <Text dimColor wrap="truncate-end">
                    {l.replace(ws.cwd + '/', '')}
                  </Text>
                ))
              )}
            </Box>
          )}

          {ws.others.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {section('Autres dossiers surveillés')}
              {ws.others.map(o => line(shortPath(o.path), `PID ${o.pid}`, undefined, true))}
            </Box>
          )}
        </Box>
      )
    }

    const drawTab = () => {
      switch (current) {
        case 'watch':
          return watchTab()
        case 'gain':
          return gainTab()
        case 'session':
          return sessionTab()
        case 'context':
          return contextTab()
        case 'eco':
          return ecoTab()
      }
    }

    // $.state outlives a reload: a value saved by an older version may lack a field. A tab that
    // cannot be drawn says so, and the tab bar stays usable.
    const safeTab = () => {
      try {
        return drawTab()
      } catch (error) {
        return <Text color="error">Affichage impossible : {error instanceof Error ? error.message : String(error)} (↻ pour relire)</Text>
      }
    }

    return (
      <Box flexDirection="column" gap={1}>
        {tabBar}
        {safeTab()}
      </Box>
    )
  })
}
