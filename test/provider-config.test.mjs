import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_BASE_URL,
  getProviderConfig,
  normalizeBaseUrl,
} from '../overlay/services/web/modules/ai-assistant/app/src/AiProviderConfig.mjs'

test('uses the direct OpenAI endpoint by default', () => {
  const provider = getProviderConfig({ OPENAI_API_KEY: 'test-key' })
  assert.equal(provider.baseURL, DEFAULT_BASE_URL)
  assert.equal(provider.label, 'OpenAI API')
  assert.equal(provider.configured, true)
  assert.equal(provider.valid, true)
})

test('supports a server-configured Responses-compatible provider', () => {
  const provider = getProviderConfig({
    OVERLEAF_AI_API_KEY: 'local-only',
    OVERLEAF_AI_BASE_URL: 'http://192.168.178.74:18000/v1/',
    OVERLEAF_AI_PROVIDER_LABEL: 'ChatMock (local network)',
  })
  assert.equal(provider.apiKey, 'local-only')
  assert.equal(provider.baseURL, 'http://192.168.178.74:18000/v1')
  assert.equal(provider.label, 'ChatMock (local network)')
  assert.equal(provider.isDirectOpenAI, false)
})

test('fails closed for malformed or credential-bearing provider URLs', () => {
  assert.throws(() => normalizeBaseUrl('file:///tmp/provider'))
  assert.throws(() => normalizeBaseUrl('http://user:pass@127.0.0.1/v1'))
  assert.equal(
    getProviderConfig({
      OVERLEAF_AI_API_KEY: 'local-only',
      OVERLEAF_AI_BASE_URL: 'file:///tmp/provider',
    }).configured,
    false
  )
})
