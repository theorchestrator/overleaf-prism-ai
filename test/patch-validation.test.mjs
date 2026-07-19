import test from 'node:test'
import assert from 'node:assert/strict'
import { validateHunks } from '../overlay/services/web/modules/ai-assistant/app/src/PatchValidation.mjs'

test('accepts exact non-overlapping replacements', () => {
  assert.doesNotThrow(() => validateHunks('abcdef', [
    { from: 1, to: 3, oldText: 'bc', newText: 'BC' },
    { from: 4, to: 6, oldText: 'ef', newText: 'EF' },
  ]))
})

test('rejects stale, overlapping, and out-of-range patches', () => {
  assert.throws(() => validateHunks('abcdef', [{ from: 1, to: 3, oldText: 'xx', newText: '' }]), /does not match/)
  assert.throws(() => validateHunks('abcdef', [
    { from: 1, to: 4, oldText: 'bcd', newText: '' },
    { from: 3, to: 5, oldText: 'de', newText: '' },
  ]), /overlap/)
  assert.throws(() => validateHunks('abcdef', [{ from: 1, to: 9, oldText: '', newText: '' }]), /outside/)
})
