import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export class JsonlStore<T extends object> {
  constructor(private readonly path: string) {}

  async append(record: T): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    await appendFile(this.path, `${JSON.stringify(record)}\n`, 'utf8')
  }
}
