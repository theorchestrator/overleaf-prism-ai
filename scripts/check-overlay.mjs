import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const moduleRoot = path.join(root, 'overlay/services/web/modules/ai-assistant')
const required = [
  'index.mjs',
  'app/src/AiAssistantRouter.mjs',
  'app/src/AiAssistantController.mjs',
  'frontend/js/components/ai-assistant-panel.tsx',
]
for (const relative of required) await fs.access(path.join(moduleRoot, relative))

async function files(directory) {
  const result = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await files(full))
    else result.push(full)
  }
  return result
}

for (const file of await files(moduleRoot)) {
  const content = await fs.readFile(file, 'utf8')
  if (/sk-[A-Za-z0-9_-]{20,}/.test(content)) throw new Error(`Possible API key in ${file}`)
  if (/child_process|exec\(|spawn\(|docker|mongodb:\/\//.test(content)) {
    throw new Error(`Forbidden privileged capability in ${file}`)
  }
}

console.log('Overlay structure and secret/capability checks passed')
