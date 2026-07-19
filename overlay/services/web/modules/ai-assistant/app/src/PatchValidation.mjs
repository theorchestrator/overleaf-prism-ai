export const MAX_HUNKS_PER_FILE = 40
export const MAX_REPLACEMENT_CHARS = 250000

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
