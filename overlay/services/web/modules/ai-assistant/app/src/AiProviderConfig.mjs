const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

function normalizeLabel(value, fallback) {
  const label = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 80)
  return label || fallback
}

export function normalizeBaseUrl(value = DEFAULT_BASE_URL) {
  const url = new URL(String(value || DEFAULT_BASE_URL).trim())
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('AI provider base URL must use HTTP or HTTPS.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('AI provider base URL cannot contain credentials, a query, or a fragment.')
  }
  return url.toString().replace(/\/$/, '')
}

export function getProviderConfig(env = process.env) {
  const apiKey = String(env.OVERLEAF_AI_API_KEY || env.OPENAI_API_KEY || '').trim()
  try {
    const baseURL = normalizeBaseUrl(env.OVERLEAF_AI_BASE_URL)
    const isDirectOpenAI = baseURL === DEFAULT_BASE_URL
    return {
      apiKey,
      baseURL,
      configured: Boolean(apiKey),
      valid: true,
      isDirectOpenAI,
      label: normalizeLabel(
        env.OVERLEAF_AI_PROVIDER_LABEL,
        isDirectOpenAI ? 'OpenAI API' : 'administrator-configured AI provider'
      ),
    }
  } catch {
    return {
      apiKey: '',
      baseURL: null,
      configured: false,
      valid: false,
      isDirectOpenAI: false,
      label: 'invalid AI provider configuration',
    }
  }
}

export { DEFAULT_BASE_URL }
