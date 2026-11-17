import type { WatchEntry, WatchState } from '../types'
import { formatClock, t as tr } from './i18n'
import { samePath } from './paths'

// ecotokens' background index watcher. `--status --json` lists every watched directory;
// it exits 1 (« no background process running ») when there is none, which is not an error here.
export const WATCH_STATUS = ['ecotokens', 'watch', '--status', '--json']

// Always with --path: `--stop` without it stops the watchers of every directory.
export function watchStart(path: string) {
  return ['ecotokens', 'watch', '--background', '--path', path]
}

export function watchStop(path: string) {
  return ['ecotokens', 'watch', '--stop', '--path', path]
}

// The Claude plugin runtime exposes file reads through $.fs rather than Node built-ins.
export function tailLogContents(contents: string, lines = 8) {
  const offset = Math.max(0, contents.length - 256 * 1024)
  let text = contents.slice(offset)
  if (offset > 0) {
    const firstLineBreak = text.indexOf('\n')
    if (firstLineBreak >= 0) text = text.slice(firstLineBreak + 1)
  }

  return text.split(/\r?\n/).filter(line => line.trim() !== '').slice(-Math.max(1, lines)).join('\n')
}

type StatusJson = { sessions?: unknown; watcher_pid?: unknown; log_file?: unknown; started_at?: unknown }

// `ok` is false when the status command failed: every directory is then idle.
export function parseWatch(stdout: string, ok: boolean, cwd: string, now: number): WatchState {
  const map = ok ? (JSON.parse(stdout) as unknown) : {}
  if (typeof map !== 'object' || map === null || Array.isArray(map)) {
    throw new Error(tr('parse.unexpectedWatchStatus'))
  }

  const entries: WatchEntry[] = Object.entries(map as Record<string, StatusJson>).map(([path, e]) => ({
    path,
    pid: typeof e?.watcher_pid === 'number' ? e.watcher_pid : undefined,
    sessions: typeof e?.sessions === 'number' ? e.sessions : 0,
    logFile: typeof e?.log_file === 'string' ? e.log_file : undefined,
    startedAt: typeof e?.started_at === 'string' ? e.started_at : undefined,
  }))

  return {
    cwd,
    current: entries.find(en => samePath(en.path, cwd) && en.pid !== undefined),
    others: entries.filter(en => !samePath(en.path, cwd) && en.pid !== undefined),
    log: [],
    measuredAt: now,
  }
}

// The log stamps `[YYYY-MM-DD HH:MM:SS] message`: the date is dropped, the time kept.
export function parseLogTail(stdout: string) {
  return stdout
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l =>
      l.replace(/^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\]\s*/, (_match, date: string, time: string) =>
        `${formatClock(new Date(`${date}T${time}`))} `,
      ),
    )
}
