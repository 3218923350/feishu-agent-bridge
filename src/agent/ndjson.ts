import type { Readable } from 'node:stream'

export async function* parseNdjson(stdout: Readable): AsyncIterable<any> {
  let buffer = ''
  for await (const chunk of stdout) {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        yield JSON.parse(trimmed)
      } catch {
        // Ignore non-json noise from CLIs.
      }
    }
  }
  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer.trim())
    } catch {
      // Ignore trailing noise.
    }
  }
}

