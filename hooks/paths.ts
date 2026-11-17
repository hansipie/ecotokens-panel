export type EcotokensPathEnvironment = {
  platform?: string
  appData?: string
  userProfile?: string
  xdgConfigHome?: string
}

export function joinPath(base: string, ...parts: string[]) {
  const separator = base.includes('\\') && base.lastIndexOf('\\') > base.lastIndexOf('/') ? '\\' : '/'
  const trimmedBase = base.replace(/[\\/]+$/, '')
  const root = trimmedBase || (base.startsWith('/') ? '/' : base.startsWith('\\') ? '\\' : '')
  const cleanParts = parts.map(part => part.replace(/^[\\/]+|[\\/]+$/g, '')).filter(Boolean)
  if (!root) return cleanParts.join(separator)

  return root.endsWith(separator) ? root + cleanParts.join(separator) : [root, ...cleanParts].join(separator)
}

function normalizedPath(value: string) {
  return value.replaceAll('\\', '/').replace(/\/{2,}/g, '/').replace(/\/$/, '')
}

export function samePath(left: string, right: string) {
  const a = normalizedPath(left)
  const b = normalizedPath(right)
  const windowsPath = /^[a-z]:\//i.test(a) || /^[a-z]:\//i.test(b) || left.includes('\\') || right.includes('\\')

  return windowsPath ? a.toLowerCase() === b.toLowerCase() : a === b
}

export function pathBelow(path: string, parent: string) {
  const normalizedChild = normalizedPath(path)
  const normalizedRoot = normalizedPath(parent)
  const windowsPath = /^[a-z]:\//i.test(normalizedChild) || /^[a-z]:\//i.test(normalizedRoot) || path.includes('\\') || parent.includes('\\')
  const child = windowsPath ? normalizedChild.toLowerCase() : normalizedChild
  const root = windowsPath ? normalizedRoot.toLowerCase() : normalizedRoot

  return child.startsWith(`${root}/`)
}

export function relativePath(path: string, parent: string) {
  if (samePath(path, parent)) return ''
  if (!pathBelow(path, parent)) return path

  return normalizedPath(path).slice(normalizedPath(parent).length + 1)
}

export function ecotokensConfigDirectory(home: string, environment: EcotokensPathEnvironment = {}) {
  const normalizedHome = home.replaceAll('\\', '/')
  const platform = environment.platform ?? (
    environment.appData || environment.userProfile || /^[a-z]:\//i.test(normalizedHome)
      ? 'win32'
      : normalizedHome.startsWith('/Users/')
        ? 'darwin'
        : 'linux'
  )
  if (platform === 'win32') {
    const roaming = environment.appData
    const profile = environment.userProfile ?? home

    return joinPath(roaming || joinPath(profile, 'AppData', 'Roaming'), 'ecotokens')
  }

  if (platform === 'darwin') return joinPath(home, 'Library', 'Application Support', 'ecotokens')

  const configHome = environment.xdgConfigHome?.startsWith('/') ? environment.xdgConfigHome : joinPath(home, '.config')

  return joinPath(configHome, 'ecotokens')
}

export function metricsDatabasePath(home: string, environment?: EcotokensPathEnvironment) {
  return joinPath(ecotokensConfigDirectory(home, environment), 'metrics.db')
}

export function ecotokensConfigPath(home: string, environment?: EcotokensPathEnvironment) {
  return joinPath(ecotokensConfigDirectory(home, environment), 'config.json')
}
