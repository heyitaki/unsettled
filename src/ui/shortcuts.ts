// Keyboard chords for the board strip, in platform-independent terms: one
// definition drives both what the context menu prints and what the key handler
// listens for, so a menu can never advertise a chord nothing answers.

/**
 * `primary` is ⌘ on Apple platforms and Ctrl everywhere else — the modifier the
 * user's OS means by "the app one".
 */
export interface Shortcut {
  /** As `KeyboardEvent.key`; letters are matched case-insensitively. */
  key: string
  primary?: boolean
  alt?: boolean
  shift?: boolean
}

/**
 * Chords are picked around what the browser and the OS already own. ⌘W is
 * deliberately not here: it closes the browser tab, and a board editor is not
 * worth taking that away. ⌘S is taken (the Save Page dialog has no use over a
 * board), as is ⌘D (bookmarking, which every drawing app already overrides for
 * duplicate). Backspace carries the closes because ⇧⌘⌫ and ⌃⌥⌦ — the chords a
 * Shift or Alt variant on Delete would collide with — are Chrome's clear-data
 * dialog and the Windows secure attention sequence.
 *
 * No Alt chord may use a letter: Option+letter on a Mac rewrites `event.key`
 * into the character it types, so such a chord would never match.
 */
export const TAB_SHORTCUTS = {
  rename: { key: 'F2' },
  duplicate: { key: 'd', primary: true },
  save: { key: 's', primary: true },
  close: { key: 'Backspace', primary: true },
  closeOthers: { key: 'Backspace', primary: true, alt: true },
} as const satisfies Record<string, Shortcut>

export const isApplePlatform = (platform: string): boolean =>
  /^(mac|iphone|ipad|ipod)/i.test(platform)

/**
 * Whether this is an Apple platform, by whichever of the two answers the
 * browser gives: `userAgentData.platform` is the supported read, `platform`
 * the deprecated one Safari and Firefox still answer with.
 */
export function applePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const modern = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  return isApplePlatform(modern?.platform ?? navigator.platform ?? '')
}

export function matchesShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  shortcut: Shortcut,
  apple: boolean,
): boolean {
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) return false
  const primary = apple ? event.metaKey : event.ctrlKey
  // The modifier this platform did *not* pick has to be up, or ⌃S on a Mac
  // would swallow a keystroke the platform means for something else.
  const foreign = apple ? event.ctrlKey : event.metaKey
  return primary === (shortcut.primary === true) &&
    !foreign &&
    event.altKey === (shortcut.alt === true) &&
    event.shiftKey === (shortcut.shift === true)
}

// Keys with a glyph on Apple keyboards; everything else prints its own name.
const APPLE_KEY_GLYPHS: Record<string, string> = {
  Backspace: '⌫',
  Delete: '⌦',
  Enter: '⏎',
  Escape: '⎋',
}

/**
 * The chord in ARIA's canonical key names, for `aria-keyshortcuts`. Assistive
 * technology reads this rather than the printed glyphs, which say "place of
 * interest sign" and "erase to the left" out loud.
 */
export function ariaKeyShortcut(shortcut: Shortcut, apple: boolean): string {
  return [
    ...(shortcut.alt === true ? ['Alt'] : []),
    ...(shortcut.shift === true ? ['Shift'] : []),
    ...(shortcut.primary === true ? [apple ? 'Meta' : 'Control'] : []),
    shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key,
  ].join('+')
}

/** The chord as this platform writes it: "⌥⌘⌫" on a Mac, "Ctrl+Alt+Backspace" elsewhere. */
export function shortcutLabel(shortcut: Shortcut, apple: boolean): string {
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key
  // Apple's order is ⌃⌥⇧⌘, then the key, with nothing between.
  if (apple) {
    return [
      shortcut.alt === true ? '⌥' : '',
      shortcut.shift === true ? '⇧' : '',
      shortcut.primary === true ? '⌘' : '',
      APPLE_KEY_GLYPHS[shortcut.key] ?? key,
    ].join('')
  }
  return [
    ...(shortcut.primary === true ? ['Ctrl'] : []),
    ...(shortcut.alt === true ? ['Alt'] : []),
    ...(shortcut.shift === true ? ['Shift'] : []),
    key,
  ].join('+')
}
