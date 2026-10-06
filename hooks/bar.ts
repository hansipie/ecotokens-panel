// Green at 0, yellow at 0.5, red at 1.
const STOPS: [number, number, number][] = [
  [0x22, 0xc5, 0x5e],
  [0xea, 0xb3, 0x08],
  [0xef, 0x44, 0x44],
]

export function gradient(t: number) {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const from = STOPS[i] ?? STOPS[0]!
  const to = STOPS[i + 1] ?? from
  const hex = from.map((c, k) => Math.round(c + ((to[k] ?? c) - c) * (x - i)).toString(16).padStart(2, '0'))

  return `#${hex.join('')}`
}

// One thin row: each filled cell takes the gradient's colour at its own place on the bar.
export function cells(percent: number, width: number) {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)

  return Array.from({ length: width }, (_, i) => ({
    isFilled: i < filled,
    color: gradient(width > 1 ? i / (width - 1) : 0),
  }))
}
