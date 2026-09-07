// `base` if free, else the first unused "base (n)", so two boards never read
// as the same board. Cosmetic only: links are ids, not titles.
export function firstFreeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let index = 1
  while (taken.has(`${base} (${index})`)) index += 1
  return `${base} (${index})`
}

/** Whether `candidate` is a "base (n)" that firstFreeName would have minted for `base`. */
export function isCopyName(base: string, candidate: string): boolean {
  const prefix = `${base} (`
  return candidate.startsWith(prefix) && candidate.endsWith(')') && /^\d+$/.test(candidate.slice(prefix.length, -1))
}
