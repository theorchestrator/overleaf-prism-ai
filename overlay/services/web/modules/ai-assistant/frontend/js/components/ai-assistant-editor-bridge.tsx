import { useEffect } from 'react'
import { StateEffect, StateField, Text } from '@codemirror/state'
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useEditorPropertiesContext } from '@/features/ide-react/context/editor-properties-context'
import { useTrackChangesStateContext } from '@/features/review-panel/context/track-changes-state-context'
import { useUserContext } from '@/shared/context/user-context'
import { setTrackChangesUserId } from '@/features/source-editor/extensions/history-ot'

type PatchHunk = {
  from: number
  to: number
  oldText: string
  newText: string
  description?: string
}

type PreviewSpec = {
  proposalId: string
  docId: string
  path: string
  hunks: PatchHunk[]
  hunkIndexes: number[]
  appliedHunkIndexes: number[]
}

type PreviewState = {
  spec: PreviewSpec | null
  decorations: DecorationSet
}

const setPreviewEffect = StateEffect.define<PreviewSpec | null>()

function dispatchPreviewAction(
  spec: PreviewSpec,
  hunkIndex: number,
  action: 'keep' | 'undo'
) {
  window.dispatchEvent(
    new CustomEvent('ai-assistant:preview-action', {
      detail: {
        proposalId: spec.proposalId,
        docId: spec.docId,
        hunkIndex,
        action,
      },
    })
  )
}

class AiPreviewWidget extends WidgetType {
  constructor(
    readonly spec: PreviewSpec,
    readonly hunk: PatchHunk,
    readonly hunkIndex: number
  ) {
    super()
  }

  eq(other: AiPreviewWidget) {
    return (
      other.spec.proposalId === this.spec.proposalId &&
      other.spec.docId === this.spec.docId &&
      other.hunkIndex === this.hunkIndex &&
      other.hunk.newText === this.hunk.newText
    )
  }

  toDOM() {
    const container = document.createElement('div')
    container.className = 'ol-ai-preview-widget'
    container.dataset.aiProposalId = this.spec.proposalId

    if (this.hunk.newText) {
      const insertion = document.createElement('pre')
      insertion.className = 'ol-ai-preview-insert'
      insertion.textContent = this.hunk.newText.replace(/\n$/, '')
      container.appendChild(insertion)
    }

    const controls = document.createElement('div')
    controls.className = 'ol-ai-preview-controls'

    const undo = document.createElement('button')
    undo.type = 'button'
    undo.textContent = 'Undo'
    undo.title = 'Discard this AI change'
    undo.addEventListener('click', () =>
      dispatchPreviewAction(this.spec, this.hunkIndex, 'undo')
    )

    const keep = document.createElement('button')
    keep.type = 'button'
    keep.className = 'ol-ai-preview-keep'
    keep.textContent = 'Keep'
    keep.title = 'Apply this AI change'
    keep.addEventListener('click', () =>
      dispatchPreviewAction(this.spec, this.hunkIndex, 'keep')
    )

    controls.append(undo, keep)
    container.appendChild(controls)
    return container
  }
}

function rebaseHunk(
  hunk: PatchHunk,
  hunkIndex: number,
  hunks: PatchHunk[],
  appliedHunkIndexes: number[]
) {
  let delta = 0
  for (const appliedIndex of appliedHunkIndexes) {
    const applied = hunks[appliedIndex]
    if (!applied || appliedIndex === hunkIndex) continue
    if (applied.to <= hunk.from) {
      delta += applied.newText.length - (applied.to - applied.from)
    }
  }
  return { ...hunk, from: hunk.from + delta, to: hunk.to + delta }
}

function buildPreviewDecorations(doc: Text, spec: PreviewSpec) {
  const decorations = []
  for (const hunkIndex of spec.hunkIndexes) {
    const original = spec.hunks[hunkIndex]
    if (!original) continue
    const hunk = rebaseHunk(
      original,
      hunkIndex,
      spec.hunks,
      spec.appliedHunkIndexes
    )
    if (hunk.from < 0 || hunk.to > doc.length) continue

    if (hunk.to > hunk.from) {
      decorations.push(
        Decoration.mark({ class: 'ol-ai-preview-delete' }).range(
          hunk.from,
          hunk.to
        )
      )
      const firstLine = doc.lineAt(hunk.from).number
      const lastLine = doc.lineAt(Math.max(hunk.from, hunk.to - 1)).number
      for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
        decorations.push(
          Decoration.line({ class: 'ol-ai-preview-delete-line' }).range(
            doc.line(lineNumber).from
          )
        )
      }
    }

    decorations.push(
      Decoration.widget({
        widget: new AiPreviewWidget(spec, hunk, hunkIndex),
        block: true,
        side: 1,
      }).range(hunk.to)
    )
  }
  return Decoration.set(decorations, true)
}

const aiPreviewState = StateField.define<PreviewState>({
  create() {
    return { spec: null, decorations: Decoration.none }
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setPreviewEffect)) {
        return {
          spec: effect.value,
          decorations: effect.value
            ? buildPreviewDecorations(transaction.newDoc, effect.value)
            : Decoration.none,
        }
      }
    }
    if (transaction.docChanged) {
      return { spec: null, decorations: Decoration.none }
    }
    return value
  },
  provide: field =>
    EditorView.decorations.from(field, value => value.decorations),
})

const aiPreviewTheme = EditorView.baseTheme({
  '.ol-ai-preview-delete': {
    backgroundColor: 'rgba(197, 6, 11, 0.10)',
    textDecoration: 'line-through',
    textDecorationColor: 'rgba(197, 6, 11, 0.55)',
  },
  '.ol-ai-preview-delete-line': {
    backgroundColor: 'rgba(197, 6, 11, 0.07)',
  },
  '.ol-ai-preview-widget': {
    position: 'relative',
    boxSizing: 'border-box',
    width: '100%',
    backgroundColor: 'rgba(54, 179, 126, 0.16)',
    borderTop: '1px solid rgba(54, 179, 126, 0.28)',
    borderBottom: '1px solid rgba(54, 179, 126, 0.28)',
    padding: '2px 10px 3px 0',
  },
  '.ol-ai-preview-insert': {
    margin: '0',
    padding: '0 132px 0 0',
    border: '0',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    whiteSpace: 'pre-wrap',
  },
  '.ol-ai-preview-controls': {
    position: 'absolute',
    right: '8px',
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    overflow: 'hidden',
    border: '1px solid rgba(0, 0, 0, 0.18)',
    borderRadius: '16px',
    background: 'var(--bg-light-primary, #fff)',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12)',
  },
  '.ol-ai-preview-controls button': {
    border: '0',
    borderRight: '1px solid rgba(0, 0, 0, 0.12)',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    padding: '3px 9px',
    fontSize: '11px',
  },
  '.ol-ai-preview-controls button:last-child': { borderRight: '0' },
  '.ol-ai-preview-controls .ol-ai-preview-keep': {
    color: '#137333',
    backgroundColor: 'rgba(54, 179, 126, 0.12)',
  },
})

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export default function AiAssistantEditorBridge() {
  const view = useCodeMirrorViewContext()
  const { getCurrentDocumentId } = useEditorManagerContext()
  const { openDocName } = useEditorOpenDocContext()
  const { wantTrackChanges } = useEditorPropertiesContext()
  const trackChangesState = useTrackChangesStateContext()
  const user = useUserContext()

  useEffect(() => {
    if (!view.state.field(aiPreviewState, false)) {
      view.dispatch({
        effects: StateEffect.appendConfig.of([aiPreviewState, aiPreviewTheme]),
      })
    }

    const contextHandler = (event: Event) => {
      const respond = (event as CustomEvent).detail?.respond
      if (typeof respond !== 'function') return
      const selection = view.state.selection.main
      const fromLine = view.state.doc.lineAt(selection.from).number
      const toLine = view.state.doc.lineAt(
        Math.max(selection.from, selection.to - 1)
      ).number
      respond({
        docId: getCurrentDocumentId(),
        path: openDocName,
        selection: {
          from: selection.from,
          to: selection.to,
          fromLine,
          toLine,
          text: view.state.sliceDoc(selection.from, selection.to),
        },
        applyMode: wantTrackChanges ? 'tracked' : 'direct',
        trackChangesForced: trackChangesState?.onForEveryone ?? false,
      })
    }

    const previewHandler = (event: Event) => {
      const detail = (event as CustomEvent).detail as PreviewSpec & {
        respond?: (value: unknown) => void
      }
      const respond = detail.respond
      if (getCurrentDocumentId() !== detail.docId) {
        respond?.({ ok: false, error: 'The requested document is not active.' })
        return
      }
      view.dispatch({ effects: setPreviewEffect.of(detail) })
      const first = detail.hunkIndexes
        .map(index =>
          rebaseHunk(
            detail.hunks[index],
            index,
            detail.hunks,
            detail.appliedHunkIndexes
          )
        )
        .sort((left, right) => left.from - right.from)[0]
      if (first) view.dispatch(EditorView.scrollIntoView(first.from, { y: 'center' }))
      respond?.({ ok: true })
    }

    const clearPreviewHandler = () => {
      view.dispatch({ effects: setPreviewEffect.of(null) })
    }

    const applyHandler = async (event: Event) => {
      const detail = (event as CustomEvent).detail || {}
      const respond = detail.respond
      if (typeof respond !== 'function') return
      if (getCurrentDocumentId() !== detail.docId) {
        respond({ ok: false, error: 'The requested document is not active.' })
        return
      }

      const content = view.state.doc.toString()
      if ((await sha256(content)) !== detail.baseHash) {
        respond({
          ok: false,
          error: 'The document changed. Regenerate or validate the patch again.',
        })
        return
      }

      const appliedHunkIndexes: number[] = detail.appliedHunkIndexes || []
      const indexed = (detail.hunks as PatchHunk[])
        .map((hunk, index) => ({
          ...rebaseHunk(hunk, index, detail.hunks, appliedHunkIndexes),
          index,
        }))
        .filter(hunk => detail.hunkIndexes.includes(hunk.index))
        .sort((left, right) => left.from - right.from)

      for (const hunk of indexed) {
        if (content.slice(hunk.from, hunk.to) !== hunk.oldText) {
          respond({ ok: false, error: `Hunk ${hunk.index + 1} is stale.` })
          return
        }
      }

      const requestedMode = detail.applyMode || 'auto'
      if (requestedMode === 'direct' && trackChangesState?.onForEveryone) {
        respond({
          ok: false,
          error: 'Track Changes is required for everyone in this project.',
        })
        return
      }
      const applyTracked =
        requestedMode === 'auto'
          ? wantTrackChanges
          : requestedMode === 'tracked'
      if (applyTracked && !user.id) {
        respond({ ok: false, error: 'Sign in to apply tracked changes.' })
        return
      }

      const overrideTracking = applyTracked !== wantTrackChanges
      try {
        if (overrideTracking) {
          view.dispatch(
            setTrackChangesUserId(applyTracked ? user.id ?? 'anonymous' : null)
          )
        }
        view.dispatch({ effects: setPreviewEffect.of(null) })
        view.dispatch({
          changes: indexed.map(hunk => ({
            from: hunk.from,
            to: hunk.to,
            insert: hunk.newText,
          })),
        })
      } finally {
        if (overrideTracking) {
          view.dispatch(
            setTrackChangesUserId(wantTrackChanges ? user.id ?? 'anonymous' : null)
          )
        }
      }
      respond({
        ok: true,
        appliedAs: applyTracked ? 'tracked' : 'direct',
        resultingHash: await sha256(view.state.doc.toString()),
      })
    }

    window.addEventListener('ai-assistant:context', contextHandler)
    window.addEventListener('ai-assistant:preview-file', previewHandler)
    window.addEventListener('ai-assistant:clear-preview', clearPreviewHandler)
    window.addEventListener('ai-assistant:apply-file', applyHandler)
    return () => {
      window.removeEventListener('ai-assistant:context', contextHandler)
      window.removeEventListener('ai-assistant:preview-file', previewHandler)
      window.removeEventListener('ai-assistant:clear-preview', clearPreviewHandler)
      window.removeEventListener('ai-assistant:apply-file', applyHandler)
    }
  }, [
    getCurrentDocumentId,
    openDocName,
    trackChangesState?.onForEveryone,
    user.id,
    view,
    wantTrackChanges,
  ])

  return null
}
