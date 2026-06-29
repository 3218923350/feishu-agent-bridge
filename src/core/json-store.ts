import { readFile } from 'node:fs/promises'
import { writeJsonAtomic } from './atomic-write.js'

export interface VersionedStore<T> {
  schemaVersion: number
  data: T
}

export async function readVersionedJson<T>(
  path: string,
  defaults: VersionedStore<T>,
): Promise<VersionedStore<T>> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<VersionedStore<T>>
    if (parsed.schemaVersion !== defaults.schemaVersion || parsed.data === undefined) {
      return defaults
    }
    return parsed as VersionedStore<T>
  } catch {
    return defaults
  }
}

export async function writeVersionedJson<T>(path: string, store: VersionedStore<T>): Promise<void> {
  await writeJsonAtomic(path, store)
}

