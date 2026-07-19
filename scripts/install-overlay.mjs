import fs from 'node:fs/promises'
import path from 'node:path'

const [sourceRoot, overlayRoot] = process.argv.slice(2)
if (!sourceRoot || !overlayRoot) {
  throw new Error('Usage: node scripts/install-overlay.mjs <overleaf-source> <overlay>')
}

async function replaceOnce(file, before, after) {
  const original = await fs.readFile(file, 'utf8')
  const newline = original.includes('\r\n') ? '\r\n' : '\n'
  const localBefore = before.replaceAll('\n', newline)
  const localAfter = after.replaceAll('\n', newline)
  if (original.includes(localAfter) || original.includes(after)) return
  const occurrences = original.split(localBefore).length - 1
  if (occurrences !== 1) {
    throw new Error(`${file}: expected one integration marker, found ${occurrences}`)
  }
  await fs.writeFile(file, original.replace(localBefore, localAfter))
}

await fs.cp(overlayRoot, sourceRoot, { recursive: true, force: true })

const settings = path.join(sourceRoot, 'services/web/config/settings.defaults.js')
await replaceOnce(
  settings,
  '    sourceEditorComponents: [],',
  `    sourceEditorComponents: [\n      Path.resolve(\n        __dirname,\n        '../modules/ai-assistant/frontend/js/components/ai-assistant-editor-bridge'\n      ),\n    ],`
)
await replaceOnce(
  settings,
  '    pdfLogEntryHeaderActionComponents: [],',
  `    pdfLogEntryHeaderActionComponents: [\n      Path.resolve(\n        __dirname,\n        '../modules/ai-assistant/frontend/js/components/ai-assistant-log-action'\n      ),\n    ],`
)
await replaceOnce(
  settings,
  '    railEntries: [],',
  `    railEntries: [\n      Path.resolve(\n        __dirname,\n        '../modules/ai-assistant/frontend/js/components/ai-assistant-rail-entry'\n      ),\n    ],`
)
await replaceOnce(
  settings,
  "    'zotero',\n  ],",
  "    'zotero',\n    'ai-assistant',\n  ],"
)

const railContext = path.join(
  sourceRoot,
  'services/web/frontend/js/features/ide-react/context/rail-context.tsx'
)
await replaceOnce(
  railContext,
  "  | 'workbench'",
  "  | 'workbench'\n  | 'ai-assistant'"
)

console.log('Installed Overleaf AI Assistant overlay')
