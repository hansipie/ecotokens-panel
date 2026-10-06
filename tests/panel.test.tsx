import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'ecotokens-panel',
  props: {
    title: 'ecotokens-panel',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('the session tab shows context and quota once refreshed', async ($, on) => {
  const clock = mock.clock(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  await clock.set(Date.parse('2098-12-31T22:00:00Z'))
  on('session.usage', async () => ({
  value: {
    startedAt: 0,
    context: { tokens: 84_000, window: 200_000, percent: 42 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 73, resetsAt: '2099-01-01T00:00:00Z' },
      { kind: 'seven_day', percentUsed: 12.5 },
    ],
    cost: { usd: 1.234 },
  },
  }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface, ...PANE })
    await ui.press({ key: 'refresh' })
    expect(await ui.find({ type: 'Text', text: /84\.0k \/ 200k tokens/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Session \(5 h\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^73%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /réinit. dans 2 h 0 min/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Semaine \(7 j\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.23/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the model buttons are fixed, the effort buttons list what /config offers, and the current effort', async ($, on) => {
  mock.clock(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  const row = { description: undefined, provider: { plugin: 'engine', tier: 'core' }, isLocked: false } as const
  on('config.list', async () => ({
    value: [
      { ...row, key: 'model', label: 'Model', kind: 'choice', value: 'opus', options: ['fable', 'opus', 'sonnet'] },
      { ...row, key: 'effort', label: 'Effort', kind: 'choice', value: 'xhigh', options: ['medium', 'xhigh'] },
    ],
  }))

  const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  // The model row of /config is ignored: the four models always show.
  for (const key of ['model-haiku', 'model-sonnet', 'model-opus', 'model-fable']) {
    expect(await ui.find({ key })).toBeDefined()
  }
  expect((await ui.find({ key: 'model-opus' }))?.props.variant).toBe('primary')
  expect((await ui.find({ key: 'effort-xhigh' }))?.props.variant).toBe('primary')
  expect((await ui.find({ key: 'effort-medium' }))?.props.variant).toBe('secondary')
  // The effort list is the one /config offers: low is not on offer here.
  expect(await ui.find({ key: 'effort-low' })).toBeUndefined()
  await ui.unmount()
})

test('the effort buttons fall back to the built-in list when /config gives none', async ($, on) => {
  mock.clock(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.usage', async () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('config.list', async () => ({ value: [] }))

  const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface: 'terminal', ...PANE })
  await ui.press({ key: 'refresh' })
  for (const key of ['model-fable', 'model-opus', 'model-sonnet', 'model-haiku', 'effort-low', 'effort-xhigh', 'effort-max']) {
    expect(await ui.find({ key })).toBeDefined()
  }
  await ui.unmount()
})

test('the footer keeps the engine modes and adds the toggle button', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'ecotokens-panel',
      surface,
      component: 'SessionMode',
      props: { modes: ['focus'] },
    })
    expect(await ui.find({ type: 'Text', text: 'focus' })).toBeDefined()
    expect(await ui.find({ key: 'toggle' })).toBeDefined()
    await ui.unmount()
  }
})

test('the context tab breaks the window down', async ($, on) => {
  mock.clock(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.usage', async () => ({
    value: {
      startedAt: 0,
      context: {
        tokens: 60_000,
        window: 200_000,
        percent: 30,
        breakdown: {
          categories: [
            { name: 'System prompt', tokens: 3_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
            { name: 'Messages', tokens: 57_000, color: 'permission', isDeferred: false, kind: 'used' },
            { name: 'Free space', tokens: 107_000, color: 'inactive', isDeferred: false, kind: 'free' },
            { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
            { name: 'MCP tools', tokens: 9_000, color: 'inactive', isDeferred: true, kind: 'deferred' },
          ],
          totalTokens: 60_000,
          maxTokens: 200_000,
          rawMaxTokens: 200_000,
          autocompactSource: 'auto',
          percentage: 30,
          gridRows: [[{ color: 'permission', isFilled: true, categoryName: 'Messages', tokens: 57_000, percentage: 29, squareFullness: 1 }]],
          model: 'claude-opus-5-5',
          memoryFiles: [{ path: '/var/home/hansi/.claude/CLAUDE.md', type: 'User', tokens: 1_200 }],
          mcpTools: [
            { name: 'mcp__godot__run_project', serverName: 'godot', tokens: 400, isLoaded: true },
            { name: 'mcp__godot__stop_project', serverName: 'godot', tokens: 300, isLoaded: false },
          ],
          agents: [],
          autoCompactThreshold: 167_000,
          isAutoCompactEnabled: true,
          apiUsage: { input_tokens: 10, cache_creation_input_tokens: 2_000, cache_read_input_tokens: 58_000, output_tokens: 500 },
        },
      },
      rateLimits: [],
    },
  }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface, ...PANE })
    await ui.press({ key: 'refresh' })
    await ui.press({ key: 'tab-context' })
    expect(await ui.find({ type: 'Text', text: 'claude-opus-5-5' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Auto-compactage à 167k · encore 107k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '● Messages' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '57.0k · 28.5%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '~/.claude/CLAUDE.md' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'godot (1/2 outils)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '⛁' })).toBeDefined()
    await ui.press({ key: 'tab-session' })
    await ui.unmount()
  }
})

test('the ecotokens tab lists the session savings and Jev calls', async ($, on) => {
  mock.clock(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  mock.env(on, { HOME: '/home/me' })
  on('session.cwd', async () => ({ value: '/home/me/proj' }))
  on('session.usage', async () => ({
    value: { startedAt: Date.parse('2026-10-06T08:00:00Z'), context: { window: 200_000 }, rateLimits: [] },
  }))
  const queries: string[] = []
  on('process.run', async (_$, e) => {
    const sql = e.argv.at(-1) ?? ''
    queries.push(`${e.argv.at(-2)} ${sql}`)
    const rows = sql.includes('count(*)')
      ? [{ saved: 18_471, filtered: 20 }]
      : sql.includes('jev_calls')
        ? [
            { timestamp: '2026-10-06T09:16:27.735119961+00:00', purpose: 'router', agent: 'router-everyday', ok: 1, error_kind: null, http_status: null, latency_ms: 595, input_tokens: 564, output_tokens: 67, size: 'everyday', confidence: 0.89, followup_prob: 0.1 },
            { timestamp: '2026-10-06T09:10:00.000000000+00:00', purpose: 'filter_lines', agent: null, ok: 0, error_kind: 'timeout', http_status: 504, latency_ms: 5000, input_tokens: 0, output_tokens: 0, size: null, confidence: null, followup_prob: null },
          ]
        : [{ timestamp: '2026-10-06T09:06:20.043287756+00:00', command: 'Read /x/register.tsx', command_family: 'native_read', tokens_before: 1250, tokens_after: 75, savings_pct: 94, mode: 'filtered' }]

    return { value: { exitCode: 0, stdout: JSON.stringify(rows), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface, ...PANE })
    await ui.press({ key: 'tab-eco' })
    expect(queries.some(q => q.startsWith('/home/me/.config/ecotokens/metrics.db') && q.includes("timestamp >= '2026-10-06T08:00:00.000Z'"))).toBe(true)
    expect(queries.some(q => q.includes("git_root = '/home/me/proj'"))).toBe(true)
    expect(await ui.find({ type: 'Text', text: /18\.5k tokens économisés sur 20/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '−1.2k tokens (94%)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Lecture du fichier register.tsx' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Sortie filtrée (lignes inutiles retirées) · 1250 → 75 tokens' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✓ Routage du message' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Message jugé courant (p=0.89) → délégué à router-everyday (Sonnet)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✗ Filtrage IA d’une sortie trop longue' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /timeout 504 · 5000 ms · coût Jev/ })).toBeDefined()
    await ui.press({ key: 'tab-session' })
    await ui.unmount()
  }
})

test('the watch tab shows this directory\'s watcher and stops it', async ($, on) => {
  mock.clock(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.cwd', async () => ({ value: '/home/me/proj' }))
  let running = true
  const ran: string[] = []
  on('process.run', async (_$, e) => {
    ran.push(e.argv.join(' '))
    const ok = (stdout: string, exitCode = 0) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (e.argv[2] === '--stop') {
      running = false
      return ok('')
    }
    if (e.argv[2] === '--status') {
      const map = {
        ...(running ? { '/home/me/proj': { sessions: 1, watcher_pid: 42, log_file: '/l/proj.log', started_at: '2026-10-06T10:24:13.6+00:00' } } : {}),
        '/home/me/other': { sessions: 1, watcher_pid: 43, log_file: '/l/other.log', started_at: 'x' },
      }
      return ok(JSON.stringify(map))
    }
    if (e.argv[0] === 'tail') return ok('[2026-10-06 10:20:48] /home/me/proj/src/a.ts re-indexed\n')
    return ok('', 1)
  })

  const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-watch' })
  expect(await ui.find({ type: 'Text', text: 'en cours' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /PID 42 · 1 session/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /re-indexed/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '~/other' })).toBeDefined()
  await ui.press({ key: 'watch-toggle' })
  expect(ran).toContain('ecotokens watch --stop --path /home/me/proj')
  expect(await ui.find({ type: 'Text', text: 'arrêté' })).toBeDefined()
  await ui.unmount()
})

test('the gains tab reads ecotokens gain and jev for this workspace over the chosen period', async ($, on) => {
  mock.clock(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.cwd', async () => ({ value: '/home/me/proj' }))
  const ran: string[] = []
  on('process.run', async (_$, e) => {
    ran.push(e.argv.join(' '))
    const ok = (body: unknown) => ({
      value: { exitCode: 0, stdout: JSON.stringify(body), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (e.argv[1] === 'gain') {
      return ok({
        total_interceptions: 257, total_tokens_before: 136_867, total_tokens_after: 64_226, total_savings_pct: 53.07, cost_avoided_usd: 0.1462,
        by_family: { generic: { count: 197, tokens_before: 86_260, tokens_after: 52_298 } },
        by_project: {},
      })
    }
    if (e.argv[1] === 'jev') {
      return ok({
        calls: 62, ok: 62, fallbacks: 0, input_tokens: 127_211, output_tokens: 30_291, cost_usd: 0.0053, avg_latency_ms: 520, p95_latency_ms: 1191,
        by_purpose: { router: { calls: 58, ok: 58, avg_latency_ms: 512 } },
        errors: {},
        timeline: [1, 2, 3],
      })
    }
    return { value: { exitCode: 1, stdout: '', stderr: 'non', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-gain' })
  expect(ran).toContain('ecotokens gain --period today --project /home/me/proj --json')
  expect(await ui.find({ type: 'Text', text: 'Workspace : ~/proj' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /72\.6k sur 137k · 257 sorties/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Coût évité : $0.15' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'generic' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '62 · 62 réussis · 0 repli' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Routage des messages' })).toBeDefined()
  await ui.press({ key: 'period-week' })
  expect(ran).toContain('ecotokens jev --period week --project /home/me/proj --json')
  await ui.press({ key: 'tab-session' })
  await ui.unmount()
})

test('a tab whose saved state predates a field still draws', async ($, on) => {
  mock.clock(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  // A GainState saved before `project` existed.
  const saved: Record<string, unknown> = { tab: 'gain', gain: { period: 'today', measuredAt: 0, gainError: 'ancien' } }
  on('state.get', async (_$, e, next) =>
    e.plugin === 'ecotokens-panel' && e.key in saved ? { value: { value: saved[e.key] as never, version: 1 } } : next(e),
  )
  const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'tab-gain' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ancien/ })).toBeDefined()
  await ui.unmount()
})

test('the agents tab says when the session has no agent and no background task', async ($, on) => {
  mock.clock(on)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('agent.list', async () => ({ value: [] }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface, ...PANE })
    await ui.press({ key: 'tab-agents' })
    expect(await ui.find({ type: 'Text', text: 'Aucun agent ni tâche en arrière-plan dans cette session.' })).toBeDefined()
    await ui.press({ key: 'tab-session' })
    await ui.unmount()
  }
})

test('the agents tab follows a subagent from its spawn to its end, live', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.id', async () => ({ value: 'sess-1' }))
  on('ui.panes', async () => ({ value: [{ id: 'ecotokens-panel', title: 'ecotokens-panel', isShown: true, isFocused: false, isPlaced: true }] }))
  let listed: { id: string; description: string; type: string; status: 'running' | 'completed'; name?: string }[] = []
  on('agent.list', async () => ({ value: listed }))
  on('agent.spawn', async () => ({ model: 'claude-haiku-4-5', agentId: 'a1' }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))

  const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: 'Aucun agent ni tâche en arrière-plan dans cette session.' })).toBeDefined()

  listed = [{ id: 'a1', description: 'Explore the repo', type: 'Explore', status: 'running', name: 'scout' }]
  await $.agent.spawn({
    tool_use_id: 'toolu_1',
    prompt: 'Map the repo.',
    description: 'Explore the repo',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
    name: 'scout',
  })
  expect(await ui.find({ type: 'Text', text: 'scout' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '● en cours' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Explore the repo' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Explore · arrière-plan · haiku-4-5' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 agent · 0 tâche · 1 actif' })).toBeDefined()

  // The tab re-reads the list on a timer while it is shown: the elapsed time moves.
  await clock.advance(64_000)
  expect(await ui.find({ type: 'Text', text: 'depuis 1 min 04 s · 0 outil' })).toBeDefined()

  listed = [{ ...listed[0]!, status: 'completed' }]
  await $.turn.complete({
    answer: 'Done.',
    durationMs: 70_000,
    isAborted: false,
    turnId: 'turn-1',
    agentId: 'a1',
    reason: 'answer',
    usage: { input_tokens: 1_000, output_tokens: 2_000, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0, model: 'claude-haiku-4-5' },
  })
  expect(await ui.find({ type: 'Text', text: '✓ terminé' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 min 10 s · 0 outil · 41.0k → 2.0k tokens · ≈ $0.01' })).toBeDefined()

  // The engine drops the finished task: the row stays.
  listed = []
  await clock.advance(2_000)
  expect(await ui.find({ type: 'Text', text: '✓ terminé' })).toBeDefined()
  await ui.press({ key: 'tab-session' })
  await clock.advance(2_000)
  await ui.unmount()
})

test('the agents tab lists the background tasks: started, still in flight, stopped, ended', async ($, on) => {
  const clock = mock.clock(on, { now: 5_000_000 })
  on('session.id', async () => ({ value: 'sess-1' }))
  on('ui.panes', async () => ({ value: [{ id: 'ecotokens-panel', title: 'ecotokens-panel', isShown: true, isFocused: false, isPlaced: true }] }))
  on('agent.list', async () => ({ value: [{ id: 'a1', description: 'Review', type: 'general-purpose', status: 'running' as const }] }))
  on('classic.Stop', async () => ({}))
  on('tool.call', async (_$, e) => {
    if (e.tool === 'Bash') return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bash_1' } }
    if (e.tool === 'Monitor') return { result: { taskId: 'mon_1', timeoutMs: 300_000 } }
    if (e.tool === 'TaskStop') return { result: { message: 'stopped', task_id: 'mon_1', task_type: 'monitor' } }
    return { result: {} as never }
  })

  const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  expect(await ui.find({ type: 'Text', text: 'Aucune tâche en arrière-plan.' })).toBeDefined()

  await $.tool.call({ tool: 'Bash', command: 'npm run dev', description: 'Start dev server', run_in_background: true })
  await $.tool.call({ tool: 'Monitor', description: 'Watch the build log', timeout_ms: 300_000, command: 'tail -f build.log' })
  expect(await ui.find({ type: 'Text', text: 'Shell' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Start dev server' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$ npm run dev' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Monitor' })).toBeDefined()
  await clock.advance(30_000)
  expect(await ui.findAll({ type: 'Text', text: 'depuis 30 s' })).toHaveLength(2)

  await $.tool.call({ tool: 'TaskStop', task_id: 'mon_1' })
  expect(await ui.find({ type: 'Text', text: '■ arrêté' })).toBeDefined()

  // The Stop names what is in flight: a workflow it did not see start joins, the subagent stays an agent.
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      { id: 'bash_1', type: 'shell', status: 'running', description: 'Start dev server', command: 'npm run dev' },
      { id: 'wf_1', type: 'workflow', status: 'running', description: 'Nightly review', name: 'review' },
      { id: 'a1', type: 'subagent', status: 'running', description: 'Review', agent_type: 'general-purpose' },
    ],
  })
  expect(await ui.find({ type: 'Text', text: 'Workflow' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 agent · 3 tâches · 3 actifs/ })).toBeDefined()

  // Gone from the next Stop: ended, at most this long.
  await clock.advance(10_000)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  expect(await ui.findAll({ type: 'Text', text: '◇ terminé' })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: '≤ 40 s' })).toBeDefined()
  await ui.press({ key: 'tab-session' })
  await clock.advance(2_000)
  await ui.unmount()
})

// The engine under the plugin: ecotokens' databases exist, sqlite3 answers the three kinds of query.
function ecotokensRows(on: Parameters<Parameters<typeof test>[1]>[1], saved: object[], hasDb = true, config: string | null = '{"price_input_usd_per_mtok": 2.0}') {
  mock.env(on, { HOME: '/home/me' })
  on('session.cwd', async () => ({ value: '/home/me/proj' }))
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.usage', async () => ({ value: { startedAt: Date.parse('2026-10-06T08:00:00Z'), context: { window: 200_000 }, rateLimits: [] } }))
  on('fs.exists', async () => ({ value: hasDb }))
  on('fs.read', async () => {
    if (config === null) throw new Error('missing')

    return { value: config }
  })
  // The engine draws the result as it is: the plugin's line comes under it.
  on('ui.render', async () => ({ type: 'engine', ref: 0 }))
  on('tool.call', async () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  on('turn.complete', async () => ({ text: '' }))
  const logged: string[] = []
  const ran: string[][] = []
  const totals = [{ before: 27_700, after: 3_600 }, { before: 330_000, after: 18_000 }]
  on('ui.log', async (_$, e) => {
    logged.push(e.text)

    return {}
  })
  on('process.run', async (_$, e) => {
    ran.push(e.argv)
    const sql = e.argv.at(-1) ?? ''
    // The turn's savings come first, then the session's.
    const rows = sql.includes('sum(tokens_before) AS before')
      ? [totals.shift()]
      : sql.includes('count(*)')
      ? [{ saved: 24_100, filtered: 3 }]
      : sql.includes('jev_calls')
        ? [{ timestamp: '2026-10-06T09:16:27.735119961+00:00', purpose: 'router', agent: 'router-everyday', ok: 1, error_kind: null, http_status: null, latency_ms: 595, input_tokens: 564, output_tokens: 67, size: 'everyday', confidence: 0.76, followup_prob: 0.1 }]
        : saved

    return { value: { exitCode: 0, stdout: JSON.stringify(rows), stderr: '' } }
  })

  return { logged, ran }
}

test('a tool result carries what ecotokens saved on that call, a folded group the sum, and the turn its balance', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-06T09:00:00Z') })
  const saved = [
    { id: 'r1', timestamp: '2026-10-06T09:00:00.500000000+00:00', command: 'bash -c git diff --stat', cut: 0, tokens_before: 12_400, tokens_after: 1_100, mode: 'summarized' },
    { id: 'r2', timestamp: '2026-10-06T09:00:00.700000000+00:00', command: 'Read /x/register.tsx', cut: 0, tokens_before: 1_250, tokens_after: 75, mode: 'filtered' },
  ]
  const { logged } = ecotokensRows(on, saved)

  const result = (id: string) => ({ plugin: 'ecotokens-panel', surface: 'terminal', component: 'ToolResult', requestId: id, props: { tool_use_id: id, tool: 'Bash', output: {}, isErrored: false } }) as const
  const diff = await $.ui.mount(result('tu1'))
  const plain = await $.ui.mount(result('tu3'))
  const group = await $.ui.mount({
    plugin: 'ecotokens-panel',
    surface: 'terminal',
    component: 'ToolGroup',
    requestId: 'grp',
    props: { calls: [{ tool_use_id: 'tu2', tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false }], isActive: false, isExpanded: false },
  })
  expect(await diff.find({ type: 'Text', text: /ecotokens ·/ })).toBeUndefined()

  // The command ran, ecotokens wrote its row: the line appears under that call's result alone.
  await $.tool.call({ tool: 'Bash', command: 'git diff --stat', tool_use_id: 'tu1' })
  await $.tool.call({ tool: 'Read', file_path: '/x/register.tsx', tool_use_id: 'tu2' })
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'tu3' })
  expect(await diff.find({ type: 'Text', text: '  ecotokens · −11.3k tokens (−91 %) · ≈ $0.02' })).toBeDefined()
  expect(await plain.find({ type: 'Text', text: /ecotokens ·/ })).toBeUndefined()
  expect(await group.find({ type: 'Text', text: '  ecotokens · −1.2k tokens (−94 %) · < $0.01' })).toBeDefined()

  // The turn ends: what was saved in the turn and since the session started.
  await $.turn.complete({ answer: 'Done.', durationMs: 5_000, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  expect(logged).toEqual(['ecotokens · −24.1k tokens (−87 %) · ≈ $0.05 · session −312k · ≈ $0.62'])
  await clock.advance(10_000)
  await diff.unmount()
  await plain.unmount()
  await group.unmount()
})

test('without a price in the config the lines show tokens only', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-06T09:00:00Z') })
  const { logged } = ecotokensRows(on, [], true, null)

  await $.turn.complete({ answer: 'Done.', durationMs: 5_000, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  expect(logged).toEqual(['ecotokens · −24.1k tokens (−87 %) · session −312k'])
})

test('without ecotokens nothing is run and the transcript is left alone', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-06T09:00:00Z') })
  const { logged, ran } = ecotokensRows(on, [], false)

  const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface: 'terminal', component: 'ToolResult', requestId: 'tu1', props: { tool_use_id: 'tu1', tool: 'Bash', output: {}, isErrored: false } })
  await $.tool.call({ tool: 'Bash', command: 'git diff', tool_use_id: 'tu1' })
  await $.turn.complete({ answer: 'Done.', durationMs: 5_000, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  expect(ran).toEqual([])
  expect(logged).toEqual([])
  expect(await ui.find({ type: 'Text', text: /ecotokens ·/ })).toBeUndefined()
  await ui.unmount()
})

test('the liveTranscript option turns the lines off', { options: { liveTranscript: false } }, async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-06T09:00:00Z') })
  const saved = [{ id: 'r1', timestamp: '2026-10-06T09:00:00.500000000+00:00', command: 'bash -c git diff', cut: 0, tokens_before: 12_400, tokens_after: 1_100, mode: 'summarized' }]
  const { logged } = ecotokensRows(on, saved)

  const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface: 'terminal', component: 'ToolResult', requestId: 'tu1', props: { tool_use_id: 'tu1', tool: 'Bash', output: {}, isErrored: false } })
  await $.tool.call({ tool: 'Bash', command: 'git diff', tool_use_id: 'tu1' })
  await $.turn.complete({ answer: 'Done.', durationMs: 5_000, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  expect(logged).toEqual([])
  expect(await ui.find({ type: 'Text', text: /ecotokens ·/ })).toBeUndefined()
  await ui.unmount()
})

test('a delegated run writes its tokens and cost in the conversation, and the Background row shows the cost', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  on('session.id', async () => ({ value: 'sess-1' }))
  on('ui.panes', async () => ({ value: [{ id: 'ecotokens-panel', title: 'ecotokens-panel', isShown: true, isFocused: false, isPlaced: true }] }))
  on('agent.list', async () => ({ value: [{ id: 'r1', description: 'Write the email', type: 'router-everyday', status: 'completed' }] }))
  on('agent.spawn', async (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: e.subagentType === 'router-everyday' ? 'r1' : 'e1' }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  const logged: string[] = []
  on('ui.log', async (_$, e) => {
    logged.push(e.text)

    return {}
  })
  const spawn = (type: string) =>
    $.agent.spawn({ tool_use_id: 'toolu_1', prompt: 'Go.', description: 'd', subagentType: type, background: false, isTeammate: false })
  const done = (agentId: string) =>
    $.turn.complete({
      answer: 'Done.',
      durationMs: 70_000,
      isAborted: false,
      turnId: 'turn-1',
      agentId,
      reason: 'answer',
      usage: { input_tokens: 1_000, output_tokens: 2_000, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' },
    })

  const ui = await $.ui.mount({ plugin: 'ecotokens-panel', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-agents' })
  await spawn('router-everyday')
  await done('r1')
  // 1k x 2 + 2k x 10 + 40k x 0.2 = $0.03
  expect(logged).toEqual(['délégation · router-everyday (sonnet-5-5) · 41.0k → 2.0k tokens · ≈ $0.03'])
  expect(await ui.find({ type: 'Text', text: '1 min 10 s · 0 outil · 41.0k → 2.0k tokens · ≈ $0.03' })).toBeDefined()

  // Any other subagent: no line.
  await spawn('Explore')
  await done('e1')
  expect(logged).toHaveLength(1)
  await ui.unmount()
})
