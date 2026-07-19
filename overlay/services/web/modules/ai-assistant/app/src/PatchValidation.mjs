export const MAX_HUNKS_PER_FILE = 40
export const MAX_REPLACEMENT_CHARS = 250000

function lineStarts(content) {
  const starts = [0]
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') starts.push(index + 1)
  }
  return starts
}

function withTrailingNewline(text) {
  return text && !text.endsWith('\n') ? `${text}\n` : text
}

export function resolveLineHunks(content, requestedHunks) {
  const starts = lineStarts(content)
  const lineCount = starts.length
  return requestedHunks.map(hunk => {
    const startLine = hunk.startLine
    const endLine = hunk.endLine
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
      throw new Error('Patch line numbers must be integers')
    }
    if (startLine < 1 || startLine > lineCount || endLine < startLine || endLine > lineCount) {
      throw new Error(`Patch lines are outside the current document (1-${lineCount})`)
    }
    if (typeof hunk.newText !== 'string' || typeof hunk.description !== 'string') {
      throw new Error('Patch replacement and description must be strings')
    }

    if (hunk.operation === 'insert_before_line') {
      const from = starts[startLine - 1]
      return { from, to: from, oldText: '', newText: withTrailingNewline(hunk.newText), description: hunk.description }
    }
    if (hunk.operation === 'insert_after_line') {
      if (endLine < lineCount) {
        const from = starts[endLine]
        return { from, to: from, oldText: '', newText: withTrailingNewline(hunk.newText), description: hunk.description }
      }
      const prefix = content && !content.endsWith('\n') ? '\n' : ''
      return { from: content.length, to: content.length, oldText: '', newText: `${prefix}${hunk.newText}`, description: hunk.description }
    }
    if (hunk.operation === 'replace_lines') {
      const from = starts[startLine - 1]
      const to = endLine < lineCount ? starts[endLine] : content.length
      const oldText = content.slice(from, to)
      const newText = oldText.endsWith('\n') ? withTrailingNewline(hunk.newText) : hunk.newText
      return { from, to, oldText, newText, description: hunk.description }
    }
    throw new Error(`Unsupported patch operation: ${hunk.operation}`)
  })
}

export function validateHunks(content, hunks) {
  if (!Array.isArray(hunks) || hunks.length === 0 || hunks.length > MAX_HUNKS_PER_FILE) {
    throw new Error('A patch file must contain between 1 and 40 hunks')
  }

  let replacementChars = 0
  const sorted = [...hunks].sort((left, right) => left.from - right.from)
  let previousEnd = -1
  for (const hunk of sorted) {
    if (!Number.isInteger(hunk.from) || !Number.isInteger(hunk.to)) {
      throw new Error('Patch offsets must be integers')
    }
    if (hunk.from < 0 || hunk.to < hunk.from || hunk.to > content.length) {
      throw new Error('Patch offsets are outside the document')
    }
    if (hunk.from < previousEnd) throw new Error('Patch hunks overlap')
    if (typeof hunk.oldText !== 'string' || typeof hunk.newText !== 'string') {
      throw new Error('Patch text must be strings')
    }
    if (content.slice(hunk.from, hunk.to) !== hunk.oldText) {
      throw new Error('Patch oldText does not match the current document')
    }
    replacementChars += hunk.newText.length
    previousEnd = hunk.to
  }
  if (replacementChars > MAX_REPLACEMENT_CHARS) {
    throw new Error('Patch replacement is too large')
  }
}
