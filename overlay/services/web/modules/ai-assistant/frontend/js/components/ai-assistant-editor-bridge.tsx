import { useEffect } from 'react'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'

type PatchHunk = { from: number; to: number; oldText: string; newText: string }

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export default function AiAssistantEditorBridge() {
  const view = useCodeMirrorViewContext()
  const { getCurrentDocumentId } = useEditorManagerContext()

  useEffect(() => {
    const contextHandler = (event: Event) => {
      const respond = (event as CustomEvent).detail?.respond
      if (typeof respond !== 'function') return
      const selection = view.state.selection.main
      respond({
        docId: getCurrentDocumentId(),
        selection: {
          from: selection.from,
          to: selection.to,
          text: view.state.sliceDoc(selection.from, selection.to),
        },
      })
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
        respond({ ok: false, error: 'The document changed. Regenerate or validate the patch again.' })
        return
      }

      const indexed = (detail.hunks as PatchHunk[])
        .map((hunk, index) => ({ ...hunk, index }))
        .filter(hunk => detail.hunkIndexes.includes(hunk.index))
        .sort((left, right) => right.from - left.from)

      for (const hunk of indexed) {
        if (content.slice(hunk.from, hunk.to) !== hunk.oldText) {
          respond({ ok: false, error: `Hunk ${hunk.index + 1} is stale.` })
          return
        }
      }

      view.dispatch({
        changes: indexed.map(hunk => ({ from: hunk.from, to: hunk.to, insert: hunk.newText })),
        annotations: [],
      })
      respond({ ok: true, resultingHash: await sha256(view.state.doc.toString()) })
    }

    window.addEventListener('ai-assistant:context', contextHandler)
    window.addEventListener('ai-assistant:apply-file', applyHandler)
    return () => {
      window.removeEventListener('ai-assistant:context', contextHandler)
      window.removeEventListener('ai-assistant:apply-file', applyHandler)
    }
  }, [getCurrentDocumentId, view])

  return null
}
