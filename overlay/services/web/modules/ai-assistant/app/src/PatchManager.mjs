import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import { AiPatchProposal } from './models/AiPatchProposal.mjs'
import { normalizeDocument, sha256 } from './ContextBuilder.mjs'
import { resolveLineHunks, validateHunks } from './PatchValidation.mjs'

const MAX_FILES = 12

function publicProposal(proposal) {
  return {
    id: proposal._id.toString(),
    title: proposal.title,
    summary: proposal.summary,
    status: proposal.status,
    files: proposal.files.map(file => {
      const applications = proposal.applications.filter(
        item => item.docId.toString() === file.docId.toString()
      )
      return {
        path: file.path,
        docId: file.docId.toString(),
        baseVersion: file.baseVersion,
        baseHash: file.baseHash,
        appliedHunkIndexes: [
          ...new Set(applications.flatMap(item => item.appliedHunkIndexes || [])),
        ].sort((left, right) => left - right),
        appliedAs: applications.at(-1)?.appliedAs || null,
        hunks: file.hunks.map(hunk => ({
          from: hunk.from,
          to: hunk.to,
          oldText: hunk.oldText,
          newText: hunk.newText,
          description: hunk.description,
        })),
      }
    }),
  }
}

export async function createPatchProposal({
  projectId,
  userId,
  conversationId,
  title,
  summary,
  files,
  projectDocs,
}) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) {
    throw new Error('A proposal must contain between 1 and 12 files')
  }

  const normalizedFiles = []
  for (const requestedFile of files) {
    const entity = projectDocs[requestedFile.path]
    if (!entity) throw new Error(`Unknown project document: ${requestedFile.path}`)

    const latest = await ProjectEntityHandler.promises.getDoc(
      projectId,
      entity._id.toString()
    )
    const content = normalizeDocument(latest.lines)
    const resolvedHunks = resolveLineHunks(content, requestedFile.hunks)
    validateHunks(content, resolvedHunks)
    normalizedFiles.push({
      path: requestedFile.path,
      docId: entity._id,
      baseVersion: latest.version ?? latest.rev,
      baseHash: sha256(content),
      hunks: resolvedHunks,
    })
  }

  const proposal = await AiPatchProposal.create({
    projectId,
    userId,
    conversationId,
    title: String(title).slice(0, 200),
    summary: String(summary).slice(0, 5000),
    files: normalizedFiles,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  })
  return publicProposal(proposal)
}

export async function getOwnedProposal({ proposalId, projectId, userId }) {
  const proposal = await AiPatchProposal.findOne({
    _id: proposalId,
    projectId,
    userId,
  })
  if (!proposal) return null
  return proposal
}

export async function validateProposal({ proposalId, projectId, userId }) {
  const proposal = await getOwnedProposal({ proposalId, projectId, userId })
  if (!proposal) return null
  if (proposal.expiresAt < new Date() && proposal.status === 'proposed') {
    proposal.status = 'expired'
    await proposal.save()
  }
  if (proposal.status === 'expired') {
    return {
      proposal: publicProposal(proposal),
      files: proposal.files.map(file => ({
        docId: file.docId.toString(),
        path: file.path,
        status: 'expired',
      })),
    }
  }

  const files = []
  for (const file of proposal.files) {
    try {
      const latest = await ProjectEntityHandler.promises.getDoc(
        projectId,
        file.docId.toString()
      )
      const content = normalizeDocument(latest.lines)
      const currentHash = sha256(content)
      const applications = proposal.applications.filter(
        item => item.docId.toString() === file.docId.toString()
      )
      const appliedHunkIndexes = [
        ...new Set(applications.flatMap(item => item.appliedHunkIndexes || [])),
      ].sort((left, right) => left - right)
      const expectedHash = applications.at(-1)?.resultingHash || file.baseHash
      files.push({
        docId: file.docId.toString(),
        path: file.path,
        status: currentHash === expectedHash ? 'ready' : 'stale',
        currentVersion: latest.version ?? latest.rev,
        currentHash,
        appliedHunkIndexes,
      })
    } catch {
      files.push({
        docId: file.docId.toString(),
        path: file.path,
        status: 'missing-file',
      })
    }
  }
  return { proposal: publicProposal(proposal), files }
}

export async function recordApplication({
  proposalId,
  projectId,
  userId,
  docId,
  appliedHunkIndexes,
  appliedAs,
  resultingHash,
}) {
  const proposal = await getOwnedProposal({ proposalId, projectId, userId })
  if (!proposal) return null
  const file = proposal.files.find(item => item.docId.toString() === docId)
  if (!file) throw new Error('Document is not part of this proposal')
  if (
    !Array.isArray(appliedHunkIndexes) ||
    appliedHunkIndexes.length === 0 ||
    appliedHunkIndexes.some(
      index => !Number.isInteger(index) || index < 0 || index >= file.hunks.length
    )
  ) {
    throw new Error('Applied hunk indexes are invalid')
  }
  if (!/^[a-f0-9]{64}$/i.test(resultingHash || '')) {
    throw new Error('Resulting document hash is invalid')
  }
  if (!['direct', 'tracked'].includes(appliedAs)) {
    throw new Error('Patch application mode is invalid')
  }
  const previousApplications = proposal.applications.filter(
    item => item.docId.toString() === docId
  )
  const previouslyApplied = new Set(
    previousApplications.flatMap(item => item.appliedHunkIndexes || [])
  )
  if (appliedHunkIndexes.some(index => previouslyApplied.has(index))) {
    throw new Error('One or more patch hunks were already applied')
  }

  let observedVersion
  let observedHash
  try {
    const latest = await ProjectEntityHandler.promises.getDoc(projectId, docId)
    observedVersion = latest.version ?? latest.rev
    observedHash = sha256(normalizeDocument(latest.lines))
  } catch {
    // The client result is still retained when docstore observation is unavailable.
  }

  proposal.applications.push({
    docId,
    appliedHunkIndexes,
    appliedAs,
    resultingHash,
    observedVersion,
    observedHash,
    serverConfirmed: observedHash === resultingHash,
    approvedBy: userId,
    appliedAt: new Date(),
  })
  const allApplied = proposal.files.every(item => {
    const indexes = new Set(
      proposal.applications
        .filter(application => application.docId.toString() === item.docId.toString())
        .flatMap(application => application.appliedHunkIndexes || [])
    )
    return item.hunks.every((_hunk, index) => indexes.has(index))
  })
  proposal.status = allApplied
    ? 'applied'
    : 'partially-applied'
  await proposal.save()
  return publicProposal(proposal)
}

export function toPublicProposal(proposal) {
  return publicProposal(proposal)
}
