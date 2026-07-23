// Shared board-file helpers used by both the import/export panel and the map
// library. Kept in one place so the two panels stay in sync on how titles are
// derived and disambiguated.

import { validateBoard } from '../model/board'

export function fileTitle(name: string): string {
  return name.replace(/\.[^/.]+$/, '') || name
}

// First unused "base (n)" name, so a copy never clobbers an existing map.
export function nextCopyName(base: string, taken: Set<string>): string {
  let index = 1
  while (taken.has(`${base} (${index})`)) index += 1
  return `${base} (${index})`
}

// `base` if free, else the first unused "base (n)". Keeps new tab titles from
// shadowing another open tab or a saved map (title-as-link stays unambiguous).
export function firstFreeName(base: string, taken: Set<string>): string {
  return taken.has(base) ? nextCopyName(base, taken) : base
}

// Summarizes any non-blocking warnings so a load/import notice surfaces them.
export function loadedNotice(action: string, board: Parameters<typeof validateBoard>[0]): string {
  const warnings = validateBoard(board).filter((issue) => issue.severity === 'warning')
  if (warnings.length === 0) return action
  const messages = [...new Set(warnings.map((warning) => warning.message))]
  return `${action} with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${messages.join('; ')}`
}

export function downloadBoard(name: string, contents: string) {
  const blob = new Blob([contents], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name || 'board'}.catan.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
