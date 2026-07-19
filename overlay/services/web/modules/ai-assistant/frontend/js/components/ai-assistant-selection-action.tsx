import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import MaterialIcon from '@/shared/components/material-icon'
import OLButton from '@/shared/components/ol/ol-button'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import getMeta from '@/utils/meta'
import '../../stylesheets/ai-assistant.scss'

type Props = { onClose: () => void }

export default function AiAssistantSelectionAction({ onClose }: Props) {
  const view = useCodeMirrorViewContext()
  const projectId = getMeta('ol-project_id')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [allowed, setAllowed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [instruction, setInstruction] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/project/${projectId}/ai/settings`, {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(response => (response.ok ? response.json() : null))
      .then(settings => setAllowed(Boolean(settings?.allowed)))
      .catch(() => {})
    return () => controller.abort()
  }, [projectId])

  useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

  if (!allowed) return null

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const prompt = instruction.trim()
    const selection = view.state.selection.main
    if (!prompt || selection.empty) return

    window.dispatchEvent(
      new CustomEvent('ui:select-rail-tab', {
        detail: { tab: 'ai-assistant', open: true },
      })
    )
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('ai-assistant:prompt', {
          detail: { prompt },
        })
      )
    }, 50)
    onClose()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setExpanded(false)
      view.focus()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        className="review-tooltip-menu-button ai-selection-edit-button"
        onClick={() => setExpanded(true)}
        aria-label="Edit with AI"
      >
        <MaterialIcon type="auto_awesome" />
        Edit with AI
      </button>
    )
  }

  return (
    <form className="ai-selection-edit-popover" onSubmit={submit}>
      <textarea
        ref={inputRef}
        value={instruction}
        onChange={event => setInstruction(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
        placeholder="Describe how to change this selection…"
        aria-label="Describe how to edit the selected text"
      />
      <div className="ai-selection-edit-actions">
        <span>Enter to send · Shift+Enter for a new line</span>
        <OLButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setExpanded(false)
            view.focus()
          }}
        >
          Cancel
        </OLButton>
        <OLButton
          type="submit"
          variant="primary"
          size="sm"
          disabled={!instruction.trim()}
        >
          Edit with AI
        </OLButton>
      </div>
    </form>
  )
}
