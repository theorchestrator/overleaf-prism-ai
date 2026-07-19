import { AiSettings } from './models/AiSettings.mjs'
import { getProviderConfig } from './AiProviderConfig.mjs'

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function envAllowedUserIds() {
  return new Set(
    String(process.env.OVERLEAF_AI_ALLOWED_USER_IDS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  )
}

function reasoningEffort() {
  const value = process.env.OVERLEAF_AI_REASONING_EFFORT || 'high'
  return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(value)
    ? value
    : 'high'
}

export async function getEffectiveSettings() {
  const persisted = await AiSettings.findOne({ key: 'global' }).lean()
  const provider = getProviderConfig()
  const envAllowed = envAllowedUserIds()
  const persistedAllowed = new Set(
    (persisted?.allowedUserIds || []).map(id => id.toString())
  )
  const allowedUserIds = new Set([...envAllowed, ...persistedAllowed])

  return {
    enabled:
      process.env.OVERLEAF_AI_ENABLED === 'true' &&
      persisted?.enabled !== false,
    apiKeyConfigured: provider.configured,
    providerConfigurationValid: provider.valid,
    providerLabel: provider.label,
    model: process.env.OVERLEAF_AI_MODEL || 'gpt-5.6-sol',
    reasoningEffort: reasoningEffort(),
    dailyRequestLimit:
      persisted?.dailyRequestLimit ||
      positiveInteger(process.env.OVERLEAF_AI_DAILY_REQUEST_LIMIT, 30),
    monthlyTokenLimit:
      persisted?.monthlyTokenLimit ||
      positiveInteger(process.env.OVERLEAF_AI_MONTHLY_TOKEN_LIMIT, 2000000),
    maxContextChars: positiveInteger(
      process.env.OVERLEAF_AI_MAX_CONTEXT_CHARS,
      300000
    ),
    requestTimeoutMs: positiveInteger(
      process.env.OVERLEAF_AI_REQUEST_TIMEOUT_MS,
      180000
    ),
    allowedUserIds,
  }
}

export async function isUserAllowed(userId) {
  const settings = await getEffectiveSettings()
  const id = userId?.toString()
  return {
    ...settings,
    allowed: Boolean(
      settings.enabled &&
        settings.apiKeyConfigured &&
        settings.providerConfigurationValid &&
        id &&
        (settings.allowedUserIds.has('*') || settings.allowedUserIds.has(id))
    ),
  }
}

export async function getPublicSettings(userId) {
  const settings = await isUserAllowed(userId)
  return {
    enabled: settings.enabled,
    apiKeyConfigured: settings.apiKeyConfigured,
    allowed: settings.allowed,
    model: settings.model,
    providerLabel: settings.providerLabel,
    dailyRequestLimit: settings.dailyRequestLimit,
    monthlyTokenLimit: settings.monthlyTokenLimit,
    dataDisclosure:
      `Relevant manuscript context is sent to ${settings.providerLabel}. Conversations and patches are stored on this Overleaf server.`,
  }
}

export async function getAdminSettings() {
  const effective = await getEffectiveSettings()
  const persisted = await AiSettings.findOne({ key: 'global' }).lean()
  return {
    enabled: effective.enabled,
    environmentEnabled: process.env.OVERLEAF_AI_ENABLED === 'true',
    apiKeyConfigured: effective.apiKeyConfigured,
    model: effective.model,
    providerConfigurationValid: effective.providerConfigurationValid,
    providerLabel: effective.providerLabel,
    allowedUserIds: [...effective.allowedUserIds],
    dailyRequestLimit: effective.dailyRequestLimit,
    monthlyTokenLimit: effective.monthlyTokenLimit,
    persisted: Boolean(persisted),
  }
}

export async function updateAdminSettings({ userId, updates }) {
  const allowedUserIds = Array.isArray(updates.allowedUserIds)
    ? updates.allowedUserIds.filter(value => /^[a-f0-9]{24}$/i.test(value))
    : undefined
  const update = { updatedBy: userId }
  if (typeof updates.enabled === 'boolean') update.enabled = updates.enabled
  if (allowedUserIds) update.allowedUserIds = allowedUserIds
  if (Number.isInteger(updates.dailyRequestLimit) && updates.dailyRequestLimit > 0) {
    update.dailyRequestLimit = updates.dailyRequestLimit
  }
  if (Number.isInteger(updates.monthlyTokenLimit) && updates.monthlyTokenLimit > 0) {
    update.monthlyTokenLimit = updates.monthlyTokenLimit
  }
  await AiSettings.findOneAndUpdate(
    { key: 'global' },
    { $set: update, $setOnInsert: { key: 'global' } },
    { upsert: true, new: true }
  )
  return getAdminSettings()
}
