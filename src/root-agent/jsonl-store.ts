import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export class JsonlStore<T extends object> {
  constructor(private readonly path: string) {}

  async append(record: T): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    await appendFile(this.path, `${JSON.stringify(record)}\n`, 'utf8')
  }

  async readAll(): Promise<T[]> {
    try {
      const raw = await readFile(this.path, 'utf8')
      return raw.split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as T)
    } catch {
      return []
    }
  }

  async tail(count: number): Promise<T[]> {
    const all = await this.readAll()
    return all.slice(Math.max(0, all.length - count))
  }
}
