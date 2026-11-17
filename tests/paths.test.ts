import { expect, test } from 'claude-code/testing'

import { ecotokensConfigDirectory, ecotokensConfigPath, joinPath, metricsDatabasePath, pathBelow, relativePath, samePath } from '../hooks/paths'

test('Windows EcoTokens data uses the native roaming application-data directory', () => {
  const environment = { platform: 'win32', appData: 'C:\\Users\\crine\\AppData\\Roaming' }

  expect(metricsDatabasePath('C:\\Users\\crine', environment)).toBe('C:\\Users\\crine\\AppData\\Roaming\\ecotokens\\metrics.db')
  expect(ecotokensConfigPath('C:\\Users\\crine', environment)).toBe('C:\\Users\\crine\\AppData\\Roaming\\ecotokens\\config.json')
})

test('Windows path resolution falls back to USERPROFILE when APPDATA is unavailable', () => {
  expect(ecotokensConfigDirectory('C:\\Users\\crine', { platform: 'win32', userProfile: 'C:\\Users\\crine' })).toBe(
    'C:\\Users\\crine\\AppData\\Roaming\\ecotokens',
  )
})

test('Unix and macOS paths match EcoTokens platform defaults', () => {
  expect(metricsDatabasePath('/home/crine', { platform: 'linux' })).toBe('/home/crine/.config/ecotokens/metrics.db')
  expect(metricsDatabasePath('/custom/config', { platform: 'linux', xdgConfigHome: '/custom/config' })).toBe('/custom/config/ecotokens/metrics.db')
  expect(ecotokensConfigPath('/Users/crine', { platform: 'darwin' })).toBe(
    '/Users/crine/Library/Application Support/ecotokens/config.json',
  )
})

test('path helpers compare Windows paths without case or separator differences', () => {
  expect(joinPath('C:\\Users\\crine', 'AppData', 'Roaming')).toBe('C:\\Users\\crine\\AppData\\Roaming')
  expect(samePath('C:\\Users\\CRINE\\Repo', 'c:/users/crine/repo')).toBe(true)
  expect(pathBelow('C:\\Users\\crine\\Repo\\src', 'c:/users/crine/repo')).toBe(true)
  expect(relativePath('C:\\Users\\crine\\Repo\\src\\file.ts', 'c:/users/crine/repo')).toBe('src/file.ts')
})
