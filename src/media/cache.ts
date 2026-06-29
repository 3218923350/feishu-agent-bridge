import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { appPath } from '../core/paths.js'

export interface CachedAttachment {
  kind: 'image' | 'file'
  name: string
  path: string
  mimeType?: string
}

export async function attachmentDir(messageId: string, now = new Date()): Promise<string> {
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const dir = appPath('media', ym, messageId)
  await mkdir(dir, { recursive: true })
  return dir
}

export function attachmentPath(dir: string, name: string): string {
  return join(dir, name.replace(/[/:]/g, '_'))
}

