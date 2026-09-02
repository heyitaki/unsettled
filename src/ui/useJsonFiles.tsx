import { useRef } from 'react'
import { parseGame, serializeGame } from '../model/serialization'
import { listMaps } from '../persistence/localStorage'
import { downloadBoard, fileTitle, firstFreeName, loadedNotice } from './boardFiles'
import { activeTab, useStore } from './store'

/**
 * JSON import and export of boards, shared by the desktop import panel and the
 * phone's Maps menu. The browser's file picker needs a real `<input type=file>`
 * in the tree, so the hook hands back one to render along with the two actions.
 * `onImported` runs once an import has become a tab.
 */
export function useJsonFiles({ onImported }: { onImported?: () => void } = {}) {
  const { state, dispatch } = useStore()
  const { title, game } = activeTab(state)
  const inputRef = useRef<HTMLInputElement>(null)
  const notice = (message: string) => dispatch({ type: 'notice', message })
  const importJson = () => inputRef.current?.click()
  const exportJson = () => downloadBoard(title, serializeGame(game))
  const fileInput = (
    <input
      ref={inputRef}
      hidden
      type="file"
      accept=".json,application/json"
      onChange={async (event) => {
        const file = event.target.files?.[0]
        if (!file) return
        const parsed = parseGame(await file.text())
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
        event.target.value = ''
      }}
    />
  )
  return { importJson, exportJson, fileInput }
}
