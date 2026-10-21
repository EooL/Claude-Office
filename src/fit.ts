/** Scale for the fixed 1056x682 layout: never enlarges, never below 0.2 (a 0x0 viewport must not hide the app). */
export function fitScale(width: number, height: number): number {
  const s = Math.min(1, width / 1056, height / 682)
  return Number.isFinite(s) ? Math.max(0.2, s) : 1
}
