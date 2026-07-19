import { AiUsage } from './models/AiUsage.mjs'

function buckets(now = new Date()) {
  const iso = now.toISOString()
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) }
}

export async function assertWithinQuota(userId, settings) {
  const { day, month } = buckets()
  const today = await AiUsage.findOne({ userId, day }).lean()
  if ((today?.requests || 0) >= settings.dailyRequestLimit) {
    const error = new Error('Daily AI request limit reached')
    error.statusCode = 429
    throw error
  }
  const monthly = await AiUsage.aggregate([
    { $match: { userId, month } },
    {
      $group: {
        _id: null,
        tokens: { $sum: { $add: ['$inputTokens', '$outputTokens'] } },
      },
    },
  ])
  if ((monthly[0]?.tokens || 0) >= settings.monthlyTokenLimit) {
    const error = new Error('Monthly AI token limit reached')
    error.statusCode = 429
    throw error
  }
}

function configuredPrice(name) {
  const value = Number.parseFloat(process.env[name] || '')
  return Number.isFinite(value) && value >= 0 ? value : 0
}

export async function recordUsage(userId, usage = {}) {
  const { day, month } = buckets()
  const inputTokens = usage.inputTokens || usage.inputTokenCount || 0
  const outputTokens = usage.outputTokens || usage.outputTokenCount || 0
  const estimatedCostMicros = Math.round(
    inputTokens * configuredPrice('OVERLEAF_AI_INPUT_USD_PER_MILLION') +
      outputTokens * configuredPrice('OVERLEAF_AI_OUTPUT_USD_PER_MILLION')
  )
  await AiUsage.updateOne(
    { userId, day },
    {
      $setOnInsert: { month },
      $inc: { inputTokens, outputTokens, estimatedCostMicros },
    },
    { upsert: true }
  )
}

export async function recordRequest(userId) {
  const { day, month } = buckets()
  await AiUsage.updateOne(
    { userId, day },
    { $setOnInsert: { month }, $inc: { requests: 1 } },
    { upsert: true }
  )
}

export async function getUsage(userId) {
  const { day, month } = buckets()
  const today = await AiUsage.findOne({ userId, day }).lean()
  const monthly = await AiUsage.aggregate([
    { $match: { userId, month } },
    {
      $group: {
        _id: null,
        requests: { $sum: '$requests' },
        inputTokens: { $sum: '$inputTokens' },
        outputTokens: { $sum: '$outputTokens' },
        estimatedCostMicros: { $sum: '$estimatedCostMicros' },
      },
    },
  ])
  return { today: today || null, month: monthly[0] || null }
}

export async function getAggregateUsage() {
  const { month } = buckets()
  const totals = await AiUsage.aggregate([
    { $match: { month } },
    {
      $group: {
        _id: null,
        users: { $addToSet: '$userId' },
        requests: { $sum: '$requests' },
        inputTokens: { $sum: '$inputTokens' },
        outputTokens: { $sum: '$outputTokens' },
        estimatedCostMicros: { $sum: '$estimatedCostMicros' },
      },
    },
    { $project: { _id: 0, users: { $size: '$users' }, requests: 1, inputTokens: 1, outputTokens: 1, estimatedCostMicros: 1 } },
  ])
  return { month, totals: totals[0] || { users: 0, requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0 } }
}
