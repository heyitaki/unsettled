import { useRef } from 'react'
import { parseGame, serializeGame } from '../model/serialization'
import { listMaps, readLibrary } from '../persistence/localStorage'
import { createLibraryBackup, restoreLibraryBackup } from '../persistence/backup'
import { persistedWorkspace } from './workspaceSync'
import { downloadBoard, fileTitle, firstFreeName, loadedNotice } from './boardFiles'
import { activeTab, useStore } from './store'

/**
 * JSON import and export of boards, shared by the desktop Library panel and the
 * phone's Maps menu. The browser's file picker needs a real `<input type=file>`
 * in the tree, so the hook hands back one to render along with the two actions.
 * `onImported` runs once an import has become a tab.
 */
export function useJsonFiles({ onImported }: { onImported?: () => void } = {}) {
  const { state, dispatch } = useStore()
  const { title, game } = activeTab(state)
  const inputRef = useRef<HTMLInputElement>(null)
  const mode = useRef<'game' | 'backup'>('game')
  const notice = (message: string) => dispatch({ type: 'notice', message })
  const importJson = () => {
    mode.current = 'game'
    inputRef.current?.click()
  }
  const exportJson = () => downloadBoard(title, serializeGame(game))
  const exportLibrary = () => {
    try {
      downloadBoard('unsettled-library-backup', createLibraryBackup(persistedWorkspace(state.tabs).tabs))
    } catch (error) {
      notice(`Backup failed: ${error instanceof Error ? error.message : 'Unable to read the library'}`)
    }
  }
  const restoreLibrary = () => {
    mode.current = 'backup'
    inputRef.current?.click()
  }
  const fileInput = (
    <input
      ref={inputRef}
      hidden
      type="file"
      accept=".json,application/json"
      onChange={async (event) => {
        const input = event.currentTarget
        const file = input.files?.[0]
        const importing = mode.current
        if (!file) return
        try {
          const contents = await file.text()
          if (importing === 'backup') {
            const result = restoreLibraryBackup(contents)
            if (result.ok) {
              dispatch({ type: 'maps-changed', library: readLibrary() })
              notice(`Restored ${result.count} board${result.count === 1 ? '' : 's'}`)
            } else notice(`Restore failed: ${result.error}`)
            return
          }
          const parsed = parseGame(contents)
          if (parsed.ok) {
            // Disambiguate against open tabs and saved maps so two boards never
            // read as the same board. Cosmetic: links are ids, not titles.
            const reserved = new Set([
              ...state.tabs.map((tab) => tab.title),
              ...listMaps().maps.filter((map) => !map.synthetic).map((map) => map.name),
            ])
            const importTitle = firstFreeName(fileTitle(file.name), reserved)
            dispatch({ type: 'tab-add', game: parsed.game, title: importTitle })
            notice(loadedNotice(`Imported ${file.name}`, parsed.game.board))
            onImported?.()
          } else notice(`Import failed: ${parsed.errors.join('; ')}`)
        } catch (error) {
          notice(`Import failed: ${error instanceof Error ? error.message : 'Unable to read the file'}`)
        } finally { input.value = '' }
      }}
    />
  )
  return { importJson, exportJson, exportLibrary, restoreLibrary, fileInput }
}
