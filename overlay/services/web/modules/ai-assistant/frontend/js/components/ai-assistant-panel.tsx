import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
// CE+ ships marked without its declaration package; webpack resolves the runtime module.
// @ts-expect-error marked has no bundled declaration in this Overleaf image
import { marked } from 'marked'
import getMeta from '@/utils/meta'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'

type Message = { role: 'user' | 'assistant'; content: string }
type Hunk = { from: number; to: number; oldText: string; newText: string; description: string }
type PatchFile = { path: string; docId: string; baseHash: string; hunks: Hunk[] }
type Proposal = { id: string; title: string; summary: string; files: PatchFile[] }
type Conversation = { id: string; title: string }

function csrfHeaders() {
  return { 'Content-Type': 'application/json', 'X-CSRF-Token': getMeta('ol-csrfToken') }
}

function editorContext(): Promise<any> {
  return new Promise(resolve => {
    const timeout = window.setTimeout(() => resolve(null), 1000)
    window.dispatchEvent(new CustomEvent('ai-assistant:context', { detail: { respond: (value: any) => { clearTimeout(timeout); resolve(value) } } }))
  })
}

function applyInEditor(detail: any): Promise<any> {
  return new Promise(resolve => {
    const timeout = window.setTimeout(() => resolve({ ok: false, error: 'Editor did not respond.' }), 3000)
    window.dispatchEvent(new CustomEvent('ai-assistant:apply-file', { detail: { ...detail, respond: (value: any) => { clearTimeout(timeout); resolve(value) } } }))
  })
}

function Markdown({ children }: { children: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(children) as string, { USE_PROFILES: { html: true } }), [children])
  return <div className="ai-markdown" dangerouslySetInnerHTML={{ __html: html }} />
}

export default function AiAssistantPanel() {
  const projectId = getMeta('ol-project_id')
  const { openDocWithId } = useEditorManagerContext()
  const [settings, setSettings] = useState<any>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [prompt, setPrompt] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [toolActivity, setToolActivity] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [compilerDiagnostics, setCompilerDiagnostics] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const refreshConversations = useCallback(() => {
    fetch(`/project/${projectId}/ai/conversations`, { credentials: 'same-origin' })
      .then(response => response.json())
      .then(data => setConversations(data.conversations || []))
      .catch(() => {})
  }, [projectId])

  useEffect(() => {
    fetch(`/project/${projectId}/ai/settings`).then(response => response.json()).then(setSettings).catch(() => setSettings({ allowed: false }))
    refreshConversations()
  }, [projectId, refreshConversations])

  const loadConversation = async (id: string) => {
    if (!id) {
      setConversationId(null)
      setMessages([])
      setProposals([])
      return
    }
    const data = await fetch(`/project/${projectId}/ai/conversations/${id}`, { credentials: 'same-origin' }).then(response => response.json())
    setConversationId(id)
    setMessages((data.messages || []).map((message: any) => ({ role: message.role, content: message.content })))
    setProposals(data.proposals || [])
  }

  const deleteCurrentConversation = async () => {
    if (!conversationId || !window.confirm('Delete this local AI conversation?')) return
    await fetch(`/project/${projectId}/ai/conversations/${conversationId}`, { method: 'DELETE', headers: csrfHeaders(), credentials: 'same-origin' })
    await loadConversation('')
    refreshConversations()
  }

  const send = useCallback(async (requestedPrompt?: string, diagnosticsOverride?: string) => {
    const content = (requestedPrompt ?? prompt).trim()
    if (!content || busy) return
    setPrompt('')
    setError('')
    setBusy(true)
    setMessages(items => [...items, { role: 'user', content }, { role: 'assistant', content: '' }])
    const context = await editorContext()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const response = await fetch(`/project/${projectId}/ai/responses`, {
        method: 'POST',
        headers: csrfHeaders(),
        credentials: 'same-origin',
        signal: controller.signal,
        body: JSON.stringify({ conversationId, prompt: content, activeDocument: context, compilerDiagnostics: diagnosticsOverride ?? compilerDiagnostics }),
      })
      if (!response.ok || !response.body) throw new Error((await response.json().catch(() => null))?.error || `Request failed (${response.status})`)
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
          if (event.type === 'text_delta') setMessages(items => items.map((item, index) => index === items.length - 1 ? { ...item, content: item.content + event.delta } : item))
          if (event.type === 'tool_activity') setToolActivity(event.status === 'started' ? event.name.replaceAll('_', ' ') : '')
          if (event.type === 'patch') setProposals(items => [...items, event.proposal])
          if (event.type === 'compile_requested') setToolActivity('Compile requested — review the patch first.')
          if (event.type === 'error') setError(event.message)
        }
      }
    } catch (requestError: any) {
      if (requestError.name !== 'AbortError') setError(requestError.message || 'Request failed.')
    } finally {
      setBusy(false)
      setCompilerDiagnostics('')
      abortRef.current = null
      refreshConversations()
    }
  }, [busy, compilerDiagnostics, conversationId, projectId, prompt, refreshConversations])

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

  const applyFile = async (proposal: Proposal, file: PatchFile, hunkIndexes: number[]) => {
    setError('')
    const validation = await fetch(`/project/${projectId}/ai/patches/${proposal.id}/validate`, { method: 'POST', headers: csrfHeaders(), credentials: 'same-origin', body: '{}' }).then(response => response.json())
    const fileStatus = validation.files?.find((item: any) => item.docId === file.docId)
    if (fileStatus?.status !== 'ready') throw new Error(`${file.path} is stale; regenerate the proposal.`)
    await openDocWithId(file.docId)
    const applied = await applyInEditor({ docId: file.docId, baseHash: file.baseHash, hunks: file.hunks, hunkIndexes })
    if (!applied.ok) throw new Error(applied.error)
    await fetch(`/project/${projectId}/ai/patches/${proposal.id}/record`, {
      method: 'POST', headers: csrfHeaders(), credentials: 'same-origin',
      body: JSON.stringify({ docId: file.docId, appliedHunkIndexes: hunkIndexes, resultingHash: applied.resultingHash }),
    }).then(response => { if (!response.ok) throw new Error('The edit was applied, but its audit record failed.') })
  }

  if (!settings) return <div className="ai-assistant-status">Loading AI settings…</div>
  if (!settings.allowed) return <div className="ai-assistant-status"><strong>AI Assistant is disabled.</strong><br />An administrator must enable it and add your user ID to the allowlist.</div>

  return (
    <div className="ai-assistant-panel">
      <div className="ai-disclosure">Relevant manuscript context is sent to OpenAI. Edits are never applied without your approval.</div>
      <div className="ai-conversation-bar">
        <select value={conversationId || ''} onChange={event => loadConversation(event.target.value)} disabled={busy} aria-label="AI conversation">
          <option value="">New conversation</option>
          {conversations.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <button type="button" onClick={() => loadConversation('')} disabled={busy}>New</button>
        <button type="button" onClick={deleteCurrentConversation} disabled={busy || !conversationId}>Delete</button>
      </div>
      <div className="ai-messages">
        {messages.length === 0 && <div className="ai-welcome"><strong>Project-aware LaTeX assistant</strong><p>Ask about the manuscript, rewrite a selection, or use “Fix with AI” on a compiler error.</p></div>}
        {messages.map((message, index) => <div key={index} className={`ai-message ai-${message.role}`}><Markdown>{message.content || (busy ? 'Thinking…' : '')}</Markdown></div>)}
        {toolActivity && <div className="ai-tool">Using {toolActivity}…</div>}
        {proposals.map(proposal => <div className="ai-proposal" key={proposal.id}>
          <strong>{proposal.title}</strong><p>{proposal.summary}</p>
          {proposal.files.map(file => <details key={file.docId} open>
            <summary>{file.path} · {file.hunks.length} change(s)</summary>
            {file.hunks.map((hunk, index) => <div className="ai-hunk" key={index}>
              <div>{hunk.description}</div><del>{hunk.oldText || '∅'}</del><ins>{hunk.newText || '∅'}</ins>
              <button type="button" onClick={() => applyFile(proposal, file, [index]).catch(err => setError(err.message))}>Apply this hunk</button>
            </div>)}
            <button type="button" onClick={() => applyFile(proposal, file, file.hunks.map((_, index) => index)).catch(err => setError(err.message))}>Apply all changes in {file.path}</button>
          </details>)}
        </div>)}
      </div>
      {error && <div className="ai-error">{error}</div>}
      <form className="ai-composer" onSubmit={event => { event.preventDefault(); send() }}>
        <textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Ask about this project…" rows={3} disabled={busy} />
        <div>
          {!busy && messages.some(item => item.role === 'user') && <button type="button" onClick={() => send([...messages].reverse().find(item => item.role === 'user')?.content || '')}>Regenerate</button>}
          <button type="submit" disabled={busy || !prompt.trim()}>Send</button>
          {busy && <button type="button" onClick={() => abortRef.current?.abort()}>Stop</button>}
        </div>
      </form>
    </div>
  )
}
