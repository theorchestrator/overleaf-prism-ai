import { createOpenAI } from '@ai-sdk/openai'
import { streamText, stepCountIs } from 'ai'
import { z } from 'zod'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import { AiConversation } from './models/AiConversation.mjs'
import { AiMessage } from './models/AiMessage.mjs'
import { AiPatchProposal } from './models/AiPatchProposal.mjs'
import { getProviderConfig } from './AiProviderConfig.mjs'
import {
  buildManifest,
  buildSystemPrompt,
  findProjectFiles,
  listSourceComments,
  normalizeDocument,
  searchDocuments,
} from './ContextBuilder.mjs'
import {
  createPatchProposal,
  recordApplication,
  toPublicProposal,
  validateProposal,
} from './PatchManager.mjs'
import {
  getAdminSettings,
  getPublicSettings,
  isUserAllowed,
  updateAdminSettings,
} from './AiSettingsManager.mjs'
import {
  assertWithinQuota,
  getAggregateUsage,
  getUsage,
  recordRequest,
  recordUsage,
} from './AiUsageManager.mjs'

const MAX_PROMPT_CHARS = 100000
const MAX_DIAGNOSTIC_CHARS = 40000
const MAX_HISTORY_MESSAGES = 80
const MAX_TOOL_STEPS = 10

function userId(req) {
  return SessionManager.getLoggedInUserId(req.session)
}

function projectId(req) {
  return req.params.Project_id
}

function sendJsonLine(res, event) {
  if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`)
}

function safeError(error) {
  if (error?.name === 'AbortError') return 'The AI request was cancelled or timed out.'
  return error?.message || 'The AI request failed.'
}

async function ownedConversation(conversationId, projectId, ownerId) {
  if (!conversationId) return null
  return AiConversation.findOne({ _id: conversationId, projectId, userId: ownerId })
}

async function createConversation(projectId, ownerId, prompt) {
  return AiConversation.create({
    projectId,
    userId: ownerId,
    title: String(prompt).replace(/\s+/g, ' ').trim().slice(0, 160) || 'New conversation',
  })
}

function activeSnapshot(docs, requested) {
  if (!requested?.docId) return null
  const entry = Object.entries(docs).find(
    ([, doc]) => doc._id.toString() === requested.docId
  )
  if (!entry) return null
  const [path, doc] = entry
  const content = normalizeDocument(doc.lines)
  const from = Math.max(0, Math.min(content.length, Number(requested.selection?.from) || 0))
  const to = Math.max(from, Math.min(content.length, Number(requested.selection?.to) || from))
  const lines = Array.isArray(doc.lines) ? doc.lines : content.split('\n')
  const cursorLine = content.slice(0, from).split('\n').length
  const contextStart = Math.max(1, cursorLine - 5)
  const contextEnd = Math.min(lines.length, cursorLine + 5)
  return {
    path,
    docId: doc._id.toString(),
    revision: doc.rev,
    cursorLine,
    nearbyLines: lines.slice(contextStart - 1, contextEnd).map((text, index) => ({
      line: contextStart + index,
      text,
    })),
    selection: from === to ? null : { from, to, text: content.slice(from, to) },
  }
}

function patchSchema() {
  return z.object({
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(5000),
    files: z
      .array(
        z.object({
          path: z.string().min(1).max(1000),
          hunks: z
            .array(
              z.object({
                operation: z.enum([
                  'insert_before_line',
                  'insert_after_line',
                  'replace_lines',
                ]),
                startLine: z.number().int().positive(),
                endLine: z.number().int().positive(),
                newText: z.string(),
                description: z.string().max(2000),
              })
            )
            .min(1)
            .max(40),
        })
      )
      .min(1)
      .max(12),
  })
}

function projectTools({ projectId, ownerId, conversationId, docs, manifest, compilerLog, maxContextChars }) {
  let remainingContextChars = maxContextChars
  return {
    list_project_files: {
      description: 'List all project entries, including readable text documents and uploaded image or binary files.',
      inputSchema: z.object({}),
      execute: async () => ({ files: manifest }),
    },
    find_project_files: {
      description: 'Search filenames and project-relative paths across all documents and uploaded assets, including images.',
      inputSchema: z.object({ query: z.string().min(1).max(500) }),
      execute: async ({ query }) => ({ files: findProjectFiles(manifest, query) }),
    },
    list_source_comments: {
      description: 'List non-empty LaTeX source comments with exact file paths and line numbers. Use this for comments, TODOs, markers, and author notes.',
      inputSchema: z.object({ path: z.string().min(1).max(1000).optional() }),
      execute: async ({ path }) => ({ comments: listSourceComments(docs, path) }),
    },
    read_project_file: {
      description: 'Read one current project text document by its exact project-relative path.',
      inputSchema: z.object({ path: z.string().min(1).max(1000) }),
      execute: async ({ path }) => {
        const doc = docs[path]
        if (!doc) return { error: 'Document not found' }
        const content = normalizeDocument(doc.lines)
        const allowed = Math.max(0, Math.min(120000, remainingContextChars))
        const provided = content.slice(0, allowed)
        remainingContextChars -= provided.length
        return {
          path,
          docId: doc._id.toString(),
          revision: doc.rev,
          lines: provided.split('\n').map((text, index) => ({
            line: index + 1,
            text,
          })),
          truncated: content.length > allowed,
        }
      },
    },
    search_project: {
      description: 'Search all current project text documents for a literal case-insensitive phrase.',
      inputSchema: z.object({ query: z.string().min(2).max(500) }),
      execute: async ({ query }) => ({ results: searchDocuments(docs, query) }),
    },
    read_compile_diagnostics: {
      description: 'Return the compiler diagnostics supplied with this user request.',
      inputSchema: z.object({}),
      execute: async () => ({ diagnostics: compilerLog }),
    },
    request_compile: {
      description: 'Ask the Overleaf client to offer a compile. This does not compile automatically.',
      inputSchema: z.object({ reason: z.string().min(1).max(1000) }),
      execute: async ({ reason }) => ({ requested: true, reason }),
    },
    propose_patch: {
      description:
        'Create a reviewed line-based patch proposal. Use the exact 1-based line numbers returned by read_project_file. For insert operations set startLine and endLine to the target line. This never writes documents; the user must approve it in Overleaf.',
      inputSchema: patchSchema(),
      execute: async input => ({
        proposal: await createPatchProposal({
          projectId,
          userId: ownerId,
          conversationId,
          projectDocs: docs,
          ...input,
        }),
      }),
    },
  }
}

async function responses(req, res) {
  const currentProjectId = projectId(req)
  const ownerId = userId(req)
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : ''
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    return res.status(400).json({ error: 'Prompt is empty or too large.' })
  }

  const settings = await isUserAllowed(ownerId)
  if (!settings.allowed) return res.status(403).json({ error: 'AI access is disabled for this user.' })
  await assertWithinQuota(ownerId, settings)
  await recordRequest(ownerId)

  let conversation = await ownedConversation(req.body.conversationId, currentProjectId, ownerId)
  if (req.body.conversationId && !conversation) {
    return res.status(404).json({ error: 'Conversation not found.' })
  }
  conversation ||= await createConversation(currentProjectId, ownerId, prompt)

  await AiMessage.create({ conversationId: conversation._id, projectId: currentProjectId, userId: ownerId, role: 'user', content: prompt })
  await AiConversation.updateOne({ _id: conversation._id }, { $set: { updatedAt: new Date() } })

  const [docs, files, history] = await Promise.all([
    ProjectEntityHandler.promises.getAllDocs(currentProjectId),
    ProjectEntityHandler.promises.getAllFiles(currentProjectId),
    AiMessage.find({ conversationId: conversation._id })
      .sort({ createdAt: -1 })
      .limit(MAX_HISTORY_MESSAGES)
      .lean(),
  ])
  const manifest = buildManifest(docs, files)
  const compilerLog = String(req.body.compilerDiagnostics || '').slice(0, MAX_DIAGNOSTIC_CHARS)
  const system = buildSystemPrompt({
    projectManifest: manifest,
    activeDocument: activeSnapshot(docs, req.body.activeDocument),
    compilerLog,
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutMs)
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  res.status(200)
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  sendJsonLine(res, { type: 'start', conversationId: conversation._id.toString() })

  let assistantText = ''
  let lastToolError = null
  let patchProposed = false
  try {
    const provider = getProviderConfig()
    const openai = createOpenAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseURL,
    })
    const result = streamText({
      model: openai(settings.model),
      system,
      messages: history.reverse().map(message => ({ role: message.role, content: message.content })),
      tools: projectTools({
        projectId: currentProjectId,
        ownerId,
        conversationId: conversation._id,
        docs,
        manifest,
        compilerLog,
        maxContextChars: settings.maxContextChars,
      }),
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      maxOutputTokens: 16384,
      abortSignal: controller.signal,
      providerOptions: {
        openai: {
          store: false,
          reasoningEffort: settings.reasoningEffort,
          textVerbosity: 'medium',
          parallelToolCalls: false,
          strictJsonSchema: true,
        },
      },
    })

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        assistantText += part.text
        sendJsonLine(res, { type: 'text_delta', delta: part.text })
      } else if (part.type === 'tool-call') {
        sendJsonLine(res, { type: 'tool_activity', status: 'started', name: part.toolName })
      } else if (part.type === 'tool-result') {
        sendJsonLine(res, { type: 'tool_activity', status: 'finished', name: part.toolName })
        if (part.toolName === 'propose_patch' && part.output?.proposal) {
          patchProposed = true
          sendJsonLine(res, { type: 'patch', proposal: part.output.proposal })
        }
        if (part.toolName === 'request_compile' && part.output?.requested) {
          sendJsonLine(res, { type: 'compile_requested', reason: part.output.reason })
        }
      } else if (part.type === 'source') {
        sendJsonLine(res, { type: 'source', source: part })
      } else if (part.type === 'tool-error') {
        lastToolError = part.error
        sendJsonLine(res, { type: 'tool_activity', status: 'retrying', name: part.toolName })
      } else if (part.type === 'error') {
        throw part.error
      }
    }

    if (lastToolError && !assistantText && !patchProposed) throw lastToolError

    const usage = await result.totalUsage
    await Promise.all([
      AiMessage.create({
        conversationId: conversation._id,
        projectId: currentProjectId,
        userId: ownerId,
        role: 'assistant',
        content: assistantText || 'No textual response.',
        usage,
      }),
      recordUsage(ownerId, usage),
    ])
    sendJsonLine(res, { type: 'finish', usage })
  } catch (error) {
    sendJsonLine(res, { type: 'error', message: safeError(error), retryable: true })
  } finally {
    clearTimeout(timeout)
    if (!res.writableEnded) res.end()
  }
}

async function listConversations(req, res) {
  const items = await AiConversation.find({ projectId: projectId(req), userId: userId(req) })
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean()
  res.json({ conversations: items.map(item => ({ id: item._id, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt })) })
}

async function getConversation(req, res) {
  const conversation = await ownedConversation(req.params.conversationId, projectId(req), userId(req))
  if (!conversation) return res.status(404).json({ error: 'Conversation not found.' })
  const messages = await AiMessage.find({ conversationId: conversation._id }).sort({ createdAt: 1 }).lean()
  const proposals = await AiPatchProposal.find({ conversationId: conversation._id }).sort({ createdAt: 1 })
  res.json({
    conversation: { id: conversation._id, title: conversation.title },
    messages,
    proposals: proposals.map(toPublicProposal),
  })
}

async function deleteConversation(req, res) {
  const conversation = await ownedConversation(req.params.conversationId, projectId(req), userId(req))
  if (!conversation) return res.status(404).json({ error: 'Conversation not found.' })
  await Promise.all([
    AiMessage.deleteMany({ conversationId: conversation._id }),
    conversation.deleteOne(),
  ])
  res.status(204).end()
}

async function validatePatch(req, res) {
  const result = await validateProposal({ proposalId: req.params.patchId, projectId: projectId(req), userId: userId(req) })
  if (!result) return res.status(404).json({ error: 'Patch proposal not found.' })
  res.json(result)
}

async function recordPatch(req, res) {
  const result = await recordApplication({
    proposalId: req.params.patchId,
    projectId: projectId(req),
    userId: userId(req),
    docId: req.body.docId,
    appliedHunkIndexes: req.body.appliedHunkIndexes,
    appliedAs: req.body.appliedAs,
    resultingHash: req.body.resultingHash,
  })
  if (!result) return res.status(404).json({ error: 'Patch proposal not found.' })
  res.json({ proposal: result })
}

async function publicSettings(req, res) {
  res.json(await getPublicSettings(userId(req)))
}

async function usage(req, res) {
  res.json(await getUsage(userId(req)))
}

async function adminSettings(req, res) {
  res.json(await getAdminSettings())
}

async function adminUsage(req, res) {
  res.json(await getAggregateUsage())
}

async function saveAdminSettings(req, res) {
  res.json(await updateAdminSettings({ userId: userId(req), updates: req.body || {} }))
}

export default {
  responses,
  listConversations,
  getConversation,
  deleteConversation,
  validatePatch,
  recordPatch,
  publicSettings,
  usage,
  adminSettings,
  adminUsage,
  saveAdminSettings,
}
