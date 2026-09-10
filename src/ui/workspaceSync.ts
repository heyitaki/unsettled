import {
  MAPS_KEY,
  WORKSPACE_KEY,
  loadWorkspace,
  readLibrary,
  readWorkspaceBlob,
  saveWorkspaceBlob,
  storedTabLinks,
  tabLinks,
  type PersistedWorkspace,
  type WorkspaceTab,
} from '../persistence/localStorage'
import type { StoreAction, TabState } from './store'
import type { ReportSave } from './saveStatus'

/**
 * What this document holds that shared storage has not been told about: tabs it
 * opened, links it made, and tabs it closed since its last write. An incoming
 * blob was serialized before any of it happened, so it has no opinion on it and
 * an adoption has to defer to all three.
 */
export interface UnflushedWork {
  /** Opened here and never written: survives an adoption that omits it. */
  added: readonly string[]
  /** Relinked here and not written: outranks the link the blob carries. */
  relinked: readonly string[]
  /** Closed here and not written: the blob still lists it; ignore it. */
  closed: readonly string[]
}

export const NOTHING_UNFLUSHED: UnflushedWork = { added: [], relinked: [], closed: [] }

/**
 * What another document's storage write means for this one. Pure apart from
 * re-reading localStorage, so the cross-document paths are testable without a
 * DOM harness.
 *
 * `unflushed` is what this document has not written yet, and is the only thing
 * an adoption defers to. Anything else it holds is the other document's to
 * close or relink: a tab this one *has* persisted and the blob omits was closed
 * on purpose there, and re-adding it would write it straight back.
 */
export function storageActions(
  event: Pick<StorageEvent, 'key' | 'newValue'>,
  unflushed: UnflushedWork = NOTHING_UNFLUSHED,
): StoreAction[] {
  // A null key is localStorage.clear() in another document: everything changed.
  const cleared = event.key === null
  const library = cleared || event.key === MAPS_KEY ? readLibrary() : null
  const actions: StoreAction[] = []
  if (!cleared && (event.key !== WORKSPACE_KEY || event.newValue === null)) {
    if (library !== null) actions.push({ type: 'maps-changed', library })
    return actions
  }
  const restored = loadWorkspace()
  // A workspace that no longer parses leaves this document's tabs alone; they
  // are the last good copy, not something to reconcile away.
  if (restored.ok) {
    actions.push({
      type: 'workspace-adopt',
      tabs: restored.workspace.tabs,
      unflushed,
      ...(restored.warning === undefined ? {} : { warning: restored.warning }),
    })
  }
  // Reconcile after adopting, never before: a link that arrives with an adopted
  // tab still needs its title settled against the library.
  if (library !== null) actions.push({ type: 'maps-changed', library })
  return actions
}

/**
 * This document's divergence from shared storage, as the difference between
 * what it last wrote or adopted (`persisted`: tab id → linked map id) and the
 * tabs it is showing. Deliberately NOT the workspace awaiting a write: a close
 * is unflushed from the moment it happens until the moment it lands, which
 * spans a write that failed and a write that stood down to reconcile.
 *
 * `open` is null only before the first arm, when this document has not yet said
 * what it is showing and has nothing to claim against an incoming blob.
 */
export function unflushedWork(
  persisted: ReadonlyMap<string, string | null>,
  open: readonly WorkspaceTab[] | null,
): UnflushedWork {
  if (open === null) return NOTHING_UNFLUSHED
  const added: string[] = []
  const relinked: string[] = []
  for (const tab of open) {
    if (!persisted.has(tab.id)) added.push(tab.id)
    else if (persisted.get(tab.id) !== (tab.mapId ?? null)) relinked.push(tab.id)
  }
  const here = new Set(open.map((tab) => tab.id))
  const closed = [...persisted.keys()].filter((id) => !here.has(id))
  return { added, relinked, closed }
}

/**
 * The same map after adopting another document's workspace: a mirror of the
 * blob just read, which is exactly what shared storage is known to hold. Ids the
 * blob drops fall out of it, and ids it carries stay — including a tab closed
 * here whose write is still in flight, so a second event for the same blob
 * still recognises the close rather than resurrecting the tab.
 */
export function withAdopted(
  persisted: ReadonlyMap<string, string | null>,
  tabs: readonly WorkspaceTab[],
  unflushed: UnflushedWork,
): Map<string, string | null> {
  const next = tabLinks(tabs)
  // A link made here and not yet written stays unflushed: the adoption refused
  // the incoming one, so the difference is still ours to save.
  for (const id of unflushed.relinked) {
    if (next.has(id)) next.set(id, persisted.get(id) ?? null)
  }
  return next
}

/**
 * What a pending autosave should do about the blob storage currently holds.
 * `seen` is the blob this document last wrote or read.
 *
 * A document may only overwrite a blob it has seen. Anything else means another
 * one wrote while this was not listening — a window restored from bfcache is the
 * ordinary case — and overwriting would erase that work and resurrect whatever
 * it closed. Rewriting a blob byte-for-byte is skipped outright: it changes
 * nothing here and fires a storage event in every other document, and that echo,
 * landing inside another window's debounce, is what races its unflushed closes.
 */
export function writeVerdict(
  pending: string,
  stored: string | null,
  seen: string | null,
): 'write' | 'skip' | 'resync' {
  if (stored !== seen) return 'resync'
  return stored === pending ? 'skip' : 'write'
}

/**
 * The persisted shape of a workspace: everything about the tabs that outlives a
 * reload and is the same for every window. Takes the tabs rather than the whole
 * store state, so an autosave is armed by a tab change and not by a notice, a
 * highlight, or this window deciding to look at a different board.
 */
export function persistedWorkspace(tabs: readonly TabState[]): PersistedWorkspace {
  return {
    tabs: tabs.map(({ id, title, game, activePlayerId, mapId }) => ({
      id,
      title,
      game,
      // The persisted shape has no null: a deselect is session-only, and a
      // reloaded workspace comes back with the first player selected.
      ...(activePlayerId === null ? {} : { activePlayerId }),
      ...(mapId === null ? {} : { mapId }),
    })),
  }
}

export type FlushOutcome =
  // Nothing more this flush can do: written, already stored, or failed and left
  // owed for the next commit to retry.
  | 'settled'
  // Nothing was written and the work is still owed: the caller re-arms so the
  // next debounce writes the reconciled workspace in its place.
  | 'deferred'

/**
 * This document's side of the shared workspace key: what it has written, what
 * it last saw there, and what it still owes. Deliberately outside React, so
 * that two of these can be driven against one localStorage in a test — the
 * races between documents are not observable any other way, and every bug this
 * protocol has had has been a race.
 */
export function createWorkspaceSync(dispatch: (action: StoreAction) => void, report: ReportSave = () => {}) {
  // Seeded from the stored blob rather than from the initial tabs, because
  // startup reconciliation can already have changed links nothing has written,
  // and a tab invented because no workspace was stored is unflushed work.
  //
  // Tab id → linked map id, as this document has written or adopted them: what
  // it is showing and this does not hold is unflushed work, and what this holds
  // and an incoming blob does not was closed on purpose elsewhere.
  let persistedTabs = storedTabLinks()
  // The workspace blob this document last wrote or read; see writeVerdict.
  let seen = readWorkspaceBlob()
  // Which tabs are open here, as of the last commit. Null only before the first
  // arm. Deliberately separate from `owed`, and never cleared by a write: the
  // two answer different questions, and conflating them is what let a write that
  // stood down — or one that failed — forget that a tab had been closed at all,
  // so the next incoming blob put it straight back.
  let open: readonly WorkspaceTab[] | null = null
  // The workspace still owed a write, or null when storage is up to date.
  let owed: PersistedWorkspace | null = null

  const receive = (event: Pick<StorageEvent, 'key' | 'newValue'>) => {
    const flushed = persistedTabs
    const unflushed = unflushedWork(flushed, open)
    // Reading the blob is what makes it seen, whether or not it yields an
    // adoption: one that no longer parses produces no actions and must still be
    // overwritable, or this document could never write again.
    if (event.key === null || event.key === WORKSPACE_KEY) seen = readWorkspaceBlob()
    for (const action of storageActions(event, unflushed)) {
      if (action.type === 'workspace-adopt') {
        persistedTabs = withAdopted(flushed, action.tabs, unflushed)
      }
      dispatch(action)
    }
  }

  return {
    /**
     * The tabs this document is showing, and the workspace it now owes storage.
     * Called on every commit, so `open` tracks the open boards even while no write is
     * outstanding.
     */
    arm(workspace: PersistedWorkspace) {
      open = workspace.tabs
      owed = workspace
    },
    receive,
    /**
     * Re-reads shared storage from scratch. For a document restored from
     * bfcache, which was frozen through every write it should have adopted: a
     * cleared-origin event is exactly "assume nothing you hold is current".
     */
    resync() {
      receive({ key: null, newValue: null })
    },
    /**
     * Writes what is owed. `only` holds the write to that workspace, so a
     * debounce a newer edit has already superseded does nothing.
     */
    flush(only?: PersistedWorkspace): FlushOutcome {
      const workspace = owed
      if (workspace === null || (only !== undefined && only !== workspace)) return 'settled'
      const blob = JSON.stringify(workspace)
      const stored = readWorkspaceBlob()
      const verdict = writeVerdict(blob, stored, seen)
      if (verdict === 'resync') {
        // Adopt first, then drop what was owed: it described the tabs as they
        // stood before the adoption, so writing it afterwards would undo it.
        // `open` survives, which is what lets the adoption still refuse a tab
        // closed here. The caller re-arms from the reconciled state.
        receive({ key: WORKSPACE_KEY, newValue: stored })
        owed = null
        return 'deferred'
      }
      if (verdict === 'write') {
        const result = saveWorkspaceBlob(blob)
        if (!result.ok) {
          // Left owed, so the next commit — or the unload flush — retries it,
          // but without re-arming here: an immediate retry would fail the same
          // way and do it every 500ms.
          dispatch({ type: 'notice', message: `Autosave failed: ${result.error}` })
          report('workspace', { message: `Workspace autosave failed: ${result.error}` })
          return 'settled'
        }
      }
      // Storage now holds exactly this, whether this document wrote it or found
      // it already there.
      owed = null
      report('workspace', null)
      seen = blob
      persistedTabs = tabLinks(workspace.tabs)
      return 'settled'
    },
  }
}
