import { describe, expect, it } from 'vitest'
import {
  TAB_SHORTCUTS,
  ariaKeyShortcut,
  isApplePlatform,
  matchesShortcut,
  shortcutLabel,
  type Shortcut,
} from '../shortcuts'

// A keydown with nothing held, which each test then adds modifiers to.
const press = (key: string, held: Partial<KeyboardEvent> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...held,
})

describe('isApplePlatform', () => {
  it('reads the platform string every browser answers with', () => {
    expect(isApplePlatform('MacIntel')).toBe(true)
    expect(isApplePlatform('macOS')).toBe(true)
    expect(isApplePlatform('iPhone')).toBe(true)
    expect(isApplePlatform('Win32')).toBe(false)
    expect(isApplePlatform('Linux x86_64')).toBe(false)
    expect(isApplePlatform('')).toBe(false)
    // Anchored: the platform is what the string starts with, not a word that
    // happens to appear in it.
    expect(isApplePlatform('Linux Macintosh')).toBe(false)
  })
})

describe('matchesShortcut', () => {
  const save = TAB_SHORTCUTS.save

  it('takes ⌘ on Apple platforms and Ctrl everywhere else', () => {
    expect(matchesShortcut(press('s', { metaKey: true }), save, true)).toBe(true)
    expect(matchesShortcut(press('s', { ctrlKey: true }), save, false)).toBe(true)
    // The other modifier is not a synonym: ⌃S on a Mac is not a save, and it
    // would swallow a keystroke the platform means for something else.
    expect(matchesShortcut(press('s', { ctrlKey: true }), save, true)).toBe(false)
    expect(matchesShortcut(press('s', { metaKey: true }), save, false)).toBe(false)
    // Nor is it ignorable once the right one is down: ⌃⌘S holds a modifier the
    // chord does not name, and this is the only case where that check decides.
    const both = press('s', { metaKey: true, ctrlKey: true })
    expect(matchesShortcut(both, save, true)).toBe(false)
    expect(matchesShortcut(both, save, false)).toBe(false)
  })

  it('rejects a chord carrying modifiers the shortcut does not name', () => {
    expect(matchesShortcut(press('s', { metaKey: true, shiftKey: true }), save, true)).toBe(false)
    expect(matchesShortcut(press('s', { metaKey: true, altKey: true }), save, true)).toBe(false)
    expect(matchesShortcut(press('s'), save, true)).toBe(false)
  })

  it('separates the two Backspace chords by their Alt key', () => {
    const { close, closeOthers } = TAB_SHORTCUTS
    const alone = press('Backspace', { metaKey: true })
    const withAlt = press('Backspace', { metaKey: true, altKey: true })

    expect(matchesShortcut(alone, close, true)).toBe(true)
    expect(matchesShortcut(alone, closeOthers, true)).toBe(false)
    expect(matchesShortcut(withAlt, closeOthers, true)).toBe(true)
    expect(matchesShortcut(withAlt, close, true)).toBe(false)
  })

  it('matches an unmodified key and ignores letter case', () => {
    expect(matchesShortcut(press('F2'), TAB_SHORTCUTS.rename, true)).toBe(true)
    expect(matchesShortcut(press('F2', { metaKey: true }), TAB_SHORTCUTS.rename, true)).toBe(false)
    // Caps lock reports the upper-case letter for the same physical chord.
    expect(matchesShortcut(press('D', { ctrlKey: true }), TAB_SHORTCUTS.duplicate, false)).toBe(true)
  })
})

describe('shortcutLabel', () => {
  it('writes Apple chords as glyphs in the platform’s modifier order', () => {
    expect(shortcutLabel(TAB_SHORTCUTS.save, true)).toBe('⌘S')
    expect(shortcutLabel(TAB_SHORTCUTS.close, true)).toBe('⌘⌫')
    expect(shortcutLabel(TAB_SHORTCUTS.closeOthers, true)).toBe('⌥⌘⌫')
    expect(shortcutLabel(TAB_SHORTCUTS.rename, true)).toBe('F2')
  })

  it('writes the same chords as named keys everywhere else', () => {
    expect(shortcutLabel(TAB_SHORTCUTS.save, false)).toBe('Ctrl+S')
    expect(shortcutLabel(TAB_SHORTCUTS.close, false)).toBe('Ctrl+Backspace')
    expect(shortcutLabel(TAB_SHORTCUTS.closeOthers, false)).toBe('Ctrl+Alt+Backspace')
    expect(shortcutLabel(TAB_SHORTCUTS.rename, false)).toBe('F2')
  })

  it('orders every modifier it is given', () => {
    const chord: Shortcut = { key: 'k', primary: true, alt: true, shift: true }
    expect(shortcutLabel(chord, true)).toBe('⌥⇧⌘K')
    expect(shortcutLabel(chord, false)).toBe('Ctrl+Alt+Shift+K')
  })
})

describe('ariaKeyShortcut', () => {
  it('names the platform’s primary modifier the way ARIA spells it', () => {
    expect(ariaKeyShortcut(TAB_SHORTCUTS.save, true)).toBe('Meta+S')
    expect(ariaKeyShortcut(TAB_SHORTCUTS.save, false)).toBe('Control+S')
    // Never the glyphs: a screen reader reads ⌘ as "place of interest sign".
    expect(ariaKeyShortcut(TAB_SHORTCUTS.closeOthers, true)).toBe('Alt+Meta+Backspace')
    expect(ariaKeyShortcut(TAB_SHORTCUTS.closeOthers, false)).toBe('Alt+Control+Backspace')
    expect(ariaKeyShortcut(TAB_SHORTCUTS.rename, true)).toBe('F2')
  })
})

describe('TAB_SHORTCUTS', () => {
  it('holds no Alt chord on a letter key', () => {
    // Option+letter on a Mac rewrites event.key into the character it types
    // (⌥D is "∂"), so a chord matched by key must not combine the two.
    const alt = Object.values<Shortcut>(TAB_SHORTCUTS).filter((shortcut) => shortcut.alt === true)
    expect(alt.length).toBeGreaterThan(0)
    expect(alt.filter((shortcut) => shortcut.key.length === 1)).toEqual([])
  })
})
