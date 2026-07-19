import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveLineHunks,
  validateHunks,
} from '../overlay/services/web/modules/ai-assistant/app/src/PatchValidation.mjs'

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

test('resolves an insertion at an exact one-based line without model offsets', () => {
  const content = Array.from({ length: 40 }, (_, index) =>
    index === 35 ? '%' : index === 36 ? '\\author{' : `line ${index + 1}`
  ).join('\n')
  const [hunk] = resolveLineHunks(content, [{
    operation: 'insert_before_line',
    startLine: 36,
    endLine: 36,
    newText: '% tets comment',
    description: 'Add the requested comment.',
  }])
  assert.equal(hunk.oldText, '')
  assert.equal(hunk.newText, '% tets comment\n')
  assert.equal(content.slice(hunk.from).split('\n')[0], '%')
  validateHunks(content, [hunk])
})

test('accepts multiple numbered comment insertions in one document', () => {
  const content = [
    'ESA first',
    'ordinary line',
    'ESA second',
    'another line',
    'ESA third',
  ].join('\n')
  const hunks = resolveLineHunks(
    content,
    [1, 3, 5].map((line, index) => ({
      operation: 'insert_before_line',
      startLine: line,
      endLine: line,
      newText: `% #${index + 1}`,
      description: `Number ESA occurrence ${index + 1}.`,
    }))
  )
  assert.deepEqual(hunks.map(hunk => hunk.oldText), ['', '', ''])
  assert.deepEqual(hunks.map(hunk => hunk.newText), [
    '% #1\n',
    '% #2\n',
    '% #3\n',
  ])
  assert.doesNotThrow(() => validateHunks(content, hunks))
})

test('resolves whole-line replacement and insertion after the final line', () => {
  const content = 'alpha\nbeta\ngamma'
  const [replacement] = resolveLineHunks(content, [{
    operation: 'replace_lines',
    startLine: 2,
    endLine: 2,
    newText: 'BETA',
    description: 'Uppercase beta.',
  }])
  assert.deepEqual(replacement, {
    from: 6,
    to: 11,
    oldText: 'beta\n',
    newText: 'BETA\n',
    description: 'Uppercase beta.',
  })
  const [append] = resolveLineHunks(content, [{
    operation: 'insert_after_line',
    startLine: 3,
    endLine: 3,
    newText: 'delta',
    description: 'Append delta.',
  }])
  assert.equal(append.newText, '\ndelta')
})

test('rejects line operations outside the current document', () => {
  assert.throws(() => resolveLineHunks('one\ntwo', [{
    operation: 'replace_lines',
    startLine: 3,
    endLine: 3,
    newText: 'three',
    description: 'Out of range.',
  }]), /outside the current document/)
})
