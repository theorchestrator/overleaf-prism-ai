import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
// CE+ ships marked without its declaration package; webpack resolves the runtime module.
// @ts-expect-error marked has no bundled declaration in this Overleaf image
import { marked } from 'marked'
import getMeta from '@/utils/meta'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import OLButton from '@/shared/components/ol/ol-button'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'

type Message = { role: 'user' | 'assistant'; content: string }
type Hunk = {
  from: number
  to: number
  oldText: string
  newText: string
  description: string
}
type PatchFile = {
  path: string
  docId: string
  baseHash: string
  appliedHunkIndexes?: number[]
  appliedAs?: 'direct' | 'tracked' | null
  hunks: Hunk[]
}
type Proposal = {
  id: string
  title: string
  summary: string
  status?: 'proposed' | 'partially-applied' | 'applied' | 'rejected' | 'expired'
  files: PatchFile[]
}
type Conversation = { id: string; title: string }
type ApplyMode = 'auto' | 'direct' | 'tracked'
type HunkStatus = 'pending' | 'applied' | 'rejected'
type EditorContext = {
  docId: string | null
  path?: string | null
  selection?: {
    from: number
    to: number
    fromLine: number
    toLine: number
    text: string
  }
  applyMode?: 'direct' | 'tracked'
  trackChangesForced?: boolean
}

function csrfHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-CSRF-Token': getMeta('ol-csrfToken'),
  }
}

function editorEvent(
  name: string,
  detail: Record<string, unknown>,
  timeoutMs = 3000
): Promise<any> {
  return new Promise(resolve => {
    const timeout = window.setTimeout(
      () => resolve({ ok: false, error: 'Editor did not respond.' }),
      timeoutMs
    )
    window.dispatchEvent(
      new CustomEvent(name, {
        detail: {
          ...detail,
          respond: (value: any) => {
            clearTimeout(timeout)
            resolve(value)
          },
        },
      })
    )
  })
}

function editorContext(): Promise<EditorContext | null> {
  return new Promise(resolve => {
    const timeout = window.setTimeout(() => resolve(null), 1000)
    window.dispatchEvent(
      new CustomEvent('ai-assistant:context', {
        detail: {
          respond: (value: EditorContext) => {
            clearTimeout(timeout)
            resolve(value)
          },
        },
      })
    )
  })
}

function hunkKey(proposalId: string, docId: string, index: number) {
  return `${proposalId}:${docId}:${index}`
}

function storedHunkStatuses(proposals: Proposal[]) {
  const statuses: Record<string, HunkStatus> = {}
  for (const proposal of proposals) {
    for (const file of proposal.files) {
      for (const index of file.appliedHunkIndexes || []) {
        statuses[hunkKey(proposal.id, file.docId, index)] = 'applied'
      }
    }
  }
  return statuses
}

function lineCount(value: string) {
  if (!value) return 0
  return value.replace(/\n$/, '').split('\n').length
}

function fileStats(file: PatchFile) {
  return file.hunks.reduce(
    (result, hunk) => ({
      added: result.added + lineCount(hunk.newText),
      removed: result.removed + lineCount(hunk.oldText),
    }),
    { added: 0, removed: 0 }
  )
}

function toolLabel(name: string) {
  const labels: Record<string, string> = {
    list_project_files: 'Listing project files',
    find_project_files: 'Searching project files',
    list_source_comments: 'Finding source comments',
    read_project_file: 'Reading project file',
    search_project: 'Searching the manuscript',
    read_compile_diagnostics: 'Reading compiler diagnostics',
    request_compile: 'Preparing a compile request',
    propose_patch: 'Preparing reviewed changes',
  }
  return labels[name] || name.replaceAll('_', ' ')
}

function Markdown({ children }: { children: string }) {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(marked.parse(children) as string, {
        USE_PROFILES: { html: true },
      }),
    [children]
  )
  return (
    <div
      className="ai-markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export default function AiAssistantPanel() {
  const projectId = getMeta('ol-project_id')
  const { openDocWithId } = useEditorManagerContext()
  const [settings, setSettings] = useState<any>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [prompt, setPrompt] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [activities, setActivities] = useState<string[]>([])
  const [activeActivity, setActiveActivity] = useState('')
  const [lastContext, setLastContext] = useState<EditorContext | null>(null)
  const [hunkStatuses, setHunkStatuses] = useState<
    Record<string, HunkStatus>
  >({})
  const [proposalModes, setProposalModes] = useState<
    Record<string, ApplyMode>
  >({})
  const [applicationNotices, setApplicationNotices] = useState<
    Record<string, string>
  >({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [compilerDiagnostics, setCompilerDiagnostics] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const proposalsRef = useRef<Proposal[]>([])
  const hunkStatusesRef = useRef<Record<string, HunkStatus>>({})

  useEffect(() => {
    proposalsRef.current = proposals
  }, [proposals])
  useEffect(() => {
    hunkStatusesRef.current = hunkStatuses
  }, [hunkStatuses])

  const refreshConversations = useCallback(() => {
    fetch(`/project/${projectId}/ai/conversations`, {
      credentials: 'same-origin',
    })
      .then(response => response.json())
      .then(data => setConversations(data.conversations || []))
      .catch(() => {})
  }, [projectId])

  useEffect(() => {
    fetch(`/project/${projectId}/ai/settings`)
      .then(response => response.json())
      .then(setSettings)
      .catch(() => setSettings({ allowed: false }))
    refreshConversations()
    editorContext().then(setLastContext)
  }, [projectId, refreshConversations])

  const loadConversation = async (id: string) => {
    setShowDeleteConfirmation(false)
    window.dispatchEvent(new CustomEvent('ai-assistant:clear-preview'))
    if (!id) {
      setConversationId(null)
      setMessages([])
      setProposals([])
      setActivities([])
      setHunkStatuses({})
      return
    }
    const data = await fetch(
      `/project/${projectId}/ai/conversations/${id}`,
      { credentials: 'same-origin' }
    ).then(response => response.json())
    setConversationId(id)
    setMessages(
      (data.messages || []).map((message: any) => ({
        role: message.role,
        content: message.content,
      }))
    )
    const loadedProposals: Proposal[] = data.proposals || []
    setProposals(loadedProposals)
    setActivities([])
    const storedStatuses = storedHunkStatuses(loadedProposals)
    hunkStatusesRef.current = storedStatuses
    setHunkStatuses(storedStatuses)
    setApplicationNotices(
      Object.fromEntries(
        loadedProposals.flatMap(proposal => {
          const appliedAs = proposal.files.find(file => file.appliedAs)?.appliedAs
          return appliedAs
            ? [[proposal.id, `Previously kept as ${appliedAs === 'tracked' ? 'tracked changes' : 'direct edits'}.`]]
            : []
        })
      )
    )
  }

  const deleteCurrentConversation = async () => {
    if (!conversationId) return
    await fetch(`/project/${projectId}/ai/conversations/${conversationId}`, {
      method: 'DELETE',
      headers: csrfHeaders(),
      credentials: 'same-origin',
    })
    await loadConversation('')
    refreshConversations()
  }

  async function validateFile(proposal: Proposal, file: PatchFile) {
    const validation = await fetch(
      `/project/${projectId}/ai/patches/${proposal.id}/validate`,
      {
        method: 'POST',
        headers: csrfHeaders(),
        credentials: 'same-origin',
        body: '{}',
      }
    ).then(response => response.json())
    const fileStatus = validation.files?.find(
      (item: any) => item.docId === file.docId
    )
    if (fileStatus?.status !== 'ready') {
      throw new Error(`${file.path} is stale; regenerate the proposal.`)
    }
    return fileStatus
  }

  async function reviewFile(
    proposal: Proposal,
    file: PatchFile,
    indexes?: number[]
  ) {
    setError('')
    const selectedBeforeValidation = (
      indexes || file.hunks.map((_hunk, index) => index)
    ).filter(
      index =>
        !(file.appliedHunkIndexes || []).includes(index) &&
        hunkStatusesRef.current[
          hunkKey(proposal.id, file.docId, index)
        ] !== 'applied' &&
        hunkStatusesRef.current[
          hunkKey(proposal.id, file.docId, index)
        ] !== 'rejected'
    )
    if (selectedBeforeValidation.length === 0) {
      window.dispatchEvent(new CustomEvent('ai-assistant:clear-preview'))
      return
    }
    const fileStatus = await validateFile(proposal, file)
    const alreadyApplied: number[] = fileStatus.appliedHunkIndexes || []
    const selected = selectedBeforeValidation.filter(
      index =>
        !alreadyApplied.includes(index) &&
        hunkStatusesRef.current[
          hunkKey(proposal.id, file.docId, index)
        ] !== 'rejected'
    )
    if (selected.length === 0) return
    await openDocWithId(file.docId, {
      gotoOffset: file.hunks[selected[0]].from,
    })
    await new Promise(resolve => window.setTimeout(resolve, 80))
    const preview = await editorEvent('ai-assistant:preview-file', {
      proposalId: proposal.id,
      docId: file.docId,
      path: file.path,
      hunks: file.hunks,
      hunkIndexes: selected,
      appliedHunkIndexes: alreadyApplied,
    })
    if (!preview.ok) throw new Error(preview.error)
  }

  async function applyFile(
    proposal: Proposal,
    file: PatchFile,
    requestedIndexes: number[]
  ) {
    setError('')
    const fileStatus = await validateFile(proposal, file)
    const alreadyApplied: number[] = fileStatus.appliedHunkIndexes || []
    const hunkIndexes = requestedIndexes.filter(
      index => !alreadyApplied.includes(index)
    )
    if (hunkIndexes.length === 0) return
    await openDocWithId(file.docId, {
      gotoOffset: file.hunks[hunkIndexes[0]].from,
    })
    await new Promise(resolve => window.setTimeout(resolve, 80))
    const applied = await editorEvent('ai-assistant:apply-file', {
      docId: file.docId,
      baseHash: fileStatus.currentHash,
      hunks: file.hunks,
      hunkIndexes,
      appliedHunkIndexes: alreadyApplied,
      applyMode: proposalModes[proposal.id] || 'auto',
    })
    if (!applied.ok) throw new Error(applied.error)
    const recordResult = await fetch(`/project/${projectId}/ai/patches/${proposal.id}/record`, {
      method: 'POST',
      headers: csrfHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify({
        docId: file.docId,
        appliedHunkIndexes: hunkIndexes,
        appliedAs: applied.appliedAs,
        resultingHash: applied.resultingHash,
      }),
    }).then(async response => {
      if (!response.ok) {
        throw new Error('The edit was applied, but its audit record failed.')
      }
      return response.json()
    })

    if (recordResult.proposal) {
      setProposals(items =>
        items.map(item =>
          item.id === proposal.id ? recordResult.proposal : item
        )
      )
    }

    const nextStatuses = { ...hunkStatusesRef.current }
    for (const index of hunkIndexes) {
      nextStatuses[hunkKey(proposal.id, file.docId, index)] = 'applied'
    }
    hunkStatusesRef.current = nextStatuses
    setHunkStatuses(nextStatuses)
    setApplicationNotices(items => ({
      ...items,
      [proposal.id]: `Kept ${hunkIndexes.length} change${
        hunkIndexes.length === 1 ? '' : 's'
      } as ${applied.appliedAs === 'tracked' ? 'tracked changes' : 'direct edits'}.`,
    }))
  }

  function rejectHunks(
    proposal: Proposal,
    file: PatchFile,
    indexes: number[]
  ) {
    const nextStatuses = { ...hunkStatusesRef.current }
    for (const index of indexes) {
      nextStatuses[hunkKey(proposal.id, file.docId, index)] = 'rejected'
    }
    hunkStatusesRef.current = nextStatuses
    setHunkStatuses(nextStatuses)
    window.dispatchEvent(new CustomEvent('ai-assistant:clear-preview'))
    const remaining = file.hunks
      .map((_hunk, index) => index)
      .filter(
        index =>
          nextStatuses[hunkKey(proposal.id, file.docId, index)] === undefined
      )
    if (remaining.length > 0) {
      reviewFile(proposal, file, remaining).catch(err => setError(err.message))
    }
  }

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail || {}
      const proposal = proposalsRef.current.find(
        item => item.id === detail.proposalId
      )
      const file = proposal?.files.find(item => item.docId === detail.docId)
      if (!proposal || !file) return
      if (detail.action === 'undo') {
        rejectHunks(proposal, file, [detail.hunkIndex])
      } else if (detail.action === 'keep') {
        applyFile(proposal, file, [detail.hunkIndex]).catch(err =>
          setError(err.message)
        )
      }
    }
    window.addEventListener('ai-assistant:preview-action', handler)
    return () =>
      window.removeEventListener('ai-assistant:preview-action', handler)
  })

  const send = useCallback(
    async (requestedPrompt?: string, diagnosticsOverride?: string) => {
      const content = (requestedPrompt ?? prompt).trim()
      if (!content || busy) return
      setPrompt('')
      setError('')
      setBusy(true)
      setActivities([])
      setActiveActivity('Inspecting the active document')
      setMessages(items => [
        ...items,
        { role: 'user', content },
        { role: 'assistant', content: '' },
      ])
      const context = await editorContext()
      setLastContext(context)
      if (context?.selection && context.selection.to > context.selection.from) {
        setActivities([
          `Selected ${context.path || 'document'} lines ${
            context.selection.fromLine
          }–${context.selection.toLine}`,
        ])
      }
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const response = await fetch(`/project/${projectId}/ai/responses`, {
          method: 'POST',
          headers: csrfHeaders(),
          credentials: 'same-origin',
          signal: controller.signal,
          body: JSON.stringify({
            conversationId,
            prompt: content,
            activeDocument: context,
            compilerDiagnostics:
              diagnosticsOverride ?? compilerDiagnostics,
          }),
        })
        if (!response.ok || !response.body)
          throw new Error(
            (await response.json().catch(() => null))?.error ||
              `Request failed (${response.status})`
          )
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (!line) continue
            const event = JSON.parse(line)
            if (event.type === 'start') setConversationId(event.conversationId)
            if (event.type === 'text_delta')
              setMessages(items =>
                items.map((item, index) =>
                  index === items.length - 1
                    ? { ...item, content: item.content + event.delta }
                    : item
                )
              )
            if (event.type === 'tool_activity') {
              const label = toolLabel(event.name)
              if (event.status === 'started') setActiveActivity(label)
              else {
                setActiveActivity('')
                setActivities(items =>
                  items.includes(label) ? items : [...items, label]
                )
              }
            }
            if (event.type === 'patch') {
              setProposals(items => [...items, event.proposal])
              setActivities(items => [
                ...items,
                `Prepared ${event.proposal.files.length} file${
                  event.proposal.files.length === 1 ? '' : 's'
                } for review`,
              ])
              const firstFile = event.proposal.files[0]
              if (firstFile) {
                window.setTimeout(
                  () =>
                    reviewFile(event.proposal, firstFile).catch(err =>
                      setError(err.message)
                    ),
                  50
                )
              }
            }
            if (event.type === 'compile_requested')
              setActiveActivity('Compile requested — review the patch first')
            if (event.type === 'error') setError(event.message)
          }
        }
      } catch (requestError: any) {
        if (requestError.name !== 'AbortError')
          setError(requestError.message || 'Request failed.')
      } finally {
        setBusy(false)
        setActiveActivity('')
        setCompilerDiagnostics('')
        abortRef.current = null
        refreshConversations()
      }
    },
    [
      busy,
      compilerDiagnostics,
      conversationId,
      projectId,
      prompt,
      refreshConversations,
    ]
  )

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail || {}
      const diagnostics = detail.compilerDiagnostics || ''
      setCompilerDiagnostics(diagnostics)
      window.setTimeout(() => send(detail.prompt || '', diagnostics), 0)
    }
    window.addEventListener('ai-assistant:prompt', handler)
    return () => window.removeEventListener('ai-assistant:prompt', handler)
  }, [send])

  if (!settings)
    return <div className="ai-assistant-status">Loading AI settings…</div>
  if (!settings.allowed)
    return (
      <div className="ai-assistant-status">
        <strong>AI Assistant is disabled.</strong>
        <br />
        An administrator must enable it and add your user ID to the allowlist.
      </div>
    )

  return (
    <div className="ai-assistant-panel">
      <div className="ai-disclosure">
        Relevant manuscript context is sent to {settings.providerLabel}. Pending
        previews do not modify the document until you press Keep.
      </div>
      <div className="ai-conversation-bar">
        <select
          className="ai-conversation-select"
          value={conversationId || ''}
          onChange={event => loadConversation(event.target.value)}
          disabled={busy}
          aria-label="AI conversation"
        >
          <option value="">New conversation</option>
          {conversations.map(item => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        <OLTooltip
          id="ai-new-conversation-tooltip"
          description="New conversation"
          overlayProps={{ placement: 'bottom' }}
        >
          <span>
            <OLIconButton
              type="button"
              icon="add"
              size="sm"
              variant="secondary"
              accessibilityLabel="New conversation"
              onClick={() => loadConversation('')}
              disabled={busy}
            />
          </span>
        </OLTooltip>
        <OLTooltip
          id="ai-delete-conversation-tooltip"
          description="Delete conversation"
          overlayProps={{ placement: 'bottom' }}
        >
          <span>
            <OLIconButton
              type="button"
              icon="delete"
              size="sm"
              variant="danger-ghost"
              accessibilityLabel="Delete conversation"
              onClick={() => setShowDeleteConfirmation(true)}
              disabled={busy || !conversationId}
            />
          </span>
        </OLTooltip>
      </div>
      {showDeleteConfirmation && conversationId && (
        <div
          className="ai-delete-confirmation"
          role="alertdialog"
          aria-labelledby="ai-delete-confirmation-title"
        >
          <div>
            <strong id="ai-delete-confirmation-title">Delete conversation?</strong>
            <span>This removes the local AI chat history.</span>
          </div>
          <div className="ai-delete-confirmation-actions">
            <OLButton
              variant="secondary"
              size="sm"
              onClick={() => setShowDeleteConfirmation(false)}
            >
              Cancel
            </OLButton>
            <OLButton
              variant="danger"
              size="sm"
              onClick={deleteCurrentConversation}
            >
              Delete
            </OLButton>
          </div>
        </div>
      )}
      <div className="ai-messages">
        {messages.length === 0 && (
          <div className="ai-welcome">
            <strong>Project-aware LaTeX assistant</strong>
            <p>
              Ask about the manuscript, rewrite a selection, or use “Fix with
              AI” on a compiler error.
            </p>
          </div>
        )}
        {messages.map((message, index) => (
          <div key={index} className={`ai-message ai-${message.role}`}>
            <Markdown>
              {message.content || (busy ? 'Working…' : '')}
            </Markdown>
          </div>
        ))}
        {(activities.length > 0 || activeActivity) && (
          <details className="ai-activity" open={busy}>
            <summary>{activeActivity || 'Work completed'}</summary>
            {activities.map((activity, index) => (
              <div key={`${activity}-${index}`}>✓ {activity}</div>
            ))}
            {activeActivity && <div className="ai-activity-live">◌ {activeActivity}</div>}
          </details>
        )}
        {proposals.map(proposal => {
          const allIndexes = proposal.files.flatMap(file =>
            file.hunks.map((_hunk, index) => ({ file, index }))
          )
          const pending = allIndexes.filter(
            ({ file, index }) =>
              !(file.appliedHunkIndexes || []).includes(index) &&
              !hunkStatuses[
                hunkKey(proposal.id, file.docId, index)
              ]
          )
          return (
            <div className="ai-proposal" key={proposal.id}>
              <div className="ai-proposal-heading">
                <div>
                  <span className={`ai-pending-badge ai-proposal-status-${proposal.status || 'proposed'}`}>
                    {proposal.status === 'applied'
                      ? 'Applied'
                      : proposal.status === 'partially-applied'
                        ? 'Partially applied'
                        : 'Pending review'}
                  </span>
                  <strong>{proposal.title}</strong>
                </div>
                <span>{proposal.files.length} file{proposal.files.length === 1 ? '' : 's'} edited</span>
              </div>
              <p>{proposal.summary}</p>
              <div className="ai-merge-actions">
                <OLButton
                  type="button"
                  size="sm"
                  variant="secondary"
                  leadingIcon="undo"
                  onClick={() => {
                    for (const file of proposal.files) {
                      rejectHunks(
                        proposal,
                        file,
                        file.hunks
                          .map((_hunk, index) => index)
                          .filter(index =>
                            pending.some(
                              item => item.file.docId === file.docId && item.index === index
                            )
                          )
                      )
                    }
                  }}
                  disabled={pending.length === 0}
                >
                  Undo all
                </OLButton>
                <OLButton
                  type="button"
                  size="sm"
                  variant="primary"
                  leadingIcon="done_all"
                  onClick={async () => {
                    try {
                      for (const file of proposal.files) {
                        const indexes = pending
                          .filter(item => item.file.docId === file.docId)
                          .map(item => item.index)
                        if (indexes.length > 0)
                          await applyFile(proposal, file, indexes)
                      }
                    } catch (err: any) {
                      setError(err.message)
                    }
                  }}
                  disabled={pending.length === 0}
                >
                  Keep all
                </OLButton>
              </div>
              {pending.length > 0 && (
                <label className="ai-apply-mode">
                  Keep behavior
                  <select
                    value={proposalModes[proposal.id] || 'auto'}
                    onChange={event =>
                      setProposalModes(items => ({
                        ...items,
                        [proposal.id]: event.target.value as ApplyMode,
                      }))
                    }
                  >
                    <option value="auto">
                      Follow Overleaf ({lastContext?.applyMode === 'tracked' ? 'tracked changes' : 'direct edit'})
                    </option>
                    <option
                      value="direct"
                      disabled={lastContext?.trackChangesForced}
                    >
                      Apply directly
                    </option>
                    <option value="tracked">Apply as tracked changes</option>
                  </select>
                </label>
              )}
              {applicationNotices[proposal.id] && (
                <div className="ai-application-notice">
                  ✓ {applicationNotices[proposal.id]}
                </div>
              )}
              <div className="ai-file-list">
                {proposal.files.map(file => {
                  const stats = fileStats(file)
                  const statuses = file.hunks.map((_hunk, index) =>
                    (file.appliedHunkIndexes || []).includes(index)
                      ? 'applied'
                      : hunkStatuses[hunkKey(proposal.id, file.docId, index)]
                  )
                  const fileHasPending = statuses.some(status => !status)
                  return (
                    <details key={file.docId}>
                      <summary>
                        <span>
                          <strong>{file.path}</strong>
                          <em>modified</em>
                        </span>
                        <span className="ai-file-stats">
                          <b>+{stats.added}</b> <i>−{stats.removed}</i>
                        </span>
                      </summary>
                      <OLButton
                        type="button"
                        size="sm"
                        variant="secondary"
                        leadingIcon={fileHasPending ? 'rate_review' : 'check'}
                        className="ai-review-button"
                        onClick={() =>
                          reviewFile(proposal, file).catch(err =>
                            setError(err.message)
                          )
                        }
                        disabled={!fileHasPending}
                      >
                        {fileHasPending ? 'Review inline' : 'Reviewed'}
                      </OLButton>
                      {file.hunks.map((hunk, index) => {
                        const status = statuses[index] || 'pending'
                        return (
                          <div className={`ai-hunk ai-hunk-${status}`} key={index}>
                            <div>
                              {hunk.description}{' '}
                              <span className="ai-hunk-status">{status}</span>
                            </div>
                            <del>{hunk.oldText || '∅'}</del>
                            <ins>{hunk.newText || '∅'}</ins>
                            {status === 'pending' && (
                              <div className="ai-hunk-actions">
                                <OLButton
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  leadingIcon="undo"
                                  onClick={() => rejectHunks(proposal, file, [index])}
                                >
                                  Undo
                                </OLButton>
                                <OLButton
                                  type="button"
                                  size="sm"
                                  variant="primary"
                                  leadingIcon="done"
                                  onClick={() =>
                                    applyFile(proposal, file, [index]).catch(err =>
                                      setError(err.message)
                                    )
                                  }
                                >
                                  Keep
                                </OLButton>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </details>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {error && <div className="ai-error">{error}</div>}
      {lastContext?.selection &&
        lastContext.selection.to > lastContext.selection.from && (
          <div className="ai-selection-context">
            Selected {lastContext.path || 'document'} lines{' '}
            {lastContext.selection.fromLine}–{lastContext.selection.toLine}
          </div>
        )}
      <form
        className="ai-composer"
        onSubmit={event => {
          event.preventDefault()
          send()
        }}
      >
        <textarea
          value={prompt}
          onFocus={() => editorContext().then(setLastContext)}
          onChange={event => setPrompt(event.target.value)}
          placeholder="Ask about this project…"
          rows={3}
          disabled={busy}
        />
        <div className="ai-composer-actions">
          {!busy && messages.some(item => item.role === 'user') && (
            <OLTooltip
              id="ai-regenerate-tooltip"
              description="Regenerate response"
              overlayProps={{ placement: 'top' }}
            >
              <span className="ai-regenerate-action">
                <OLIconButton
                  type="button"
                  icon="refresh"
                  variant="secondary"
                  accessibilityLabel="Regenerate response"
                  onClick={() =>
                    send(
                      [...messages]
                        .reverse()
                        .find(item => item.role === 'user')?.content || ''
                    )
                  }
                />
              </span>
            </OLTooltip>
          )}
          <OLButton
            type="submit"
            size="sm"
            variant="primary"
            leadingIcon="arrow_upward"
            disabled={busy || !prompt.trim()}
          >
            Send
          </OLButton>
          {busy && (
            <OLButton
              type="button"
              size="sm"
              variant="danger-ghost"
              leadingIcon="stop_circle"
              onClick={() => abortRef.current?.abort()}
            >
              Stop
            </OLButton>
          )}
        </div>
      </form>
    </div>
  )
}
