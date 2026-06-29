import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function resolveExistingDirectory(path: string): Promise<string> {
  const resolved = resolve(path)
  const info = await stat(resolved)
  if (!info.isDirectory()) throw new Error(`not a directory: ${resolved}`)
  return resolved
}

