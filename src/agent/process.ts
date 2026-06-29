import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { AgentRun, AgentRunOptions } from './types.js'

export function spawnAgentProcess(
  command: string,
  args: string[],
  opts: AgentRunOptions,
  stdin?: string,
): { proc: ChildProcessWithoutNullStreams; runBase: Pick<AgentRun, 'runId' | 'stop' | 'waitForExit'> } {
  const proc = spawn(command, args, {
    cwd: opts.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...opts.env },
  })

  if (stdin !== undefined) {
    proc.stdin.write(stdin)
    proc.stdin.end()
  } else {
    proc.stdin.end()
  }

  const runBase = {
    runId: opts.runId,
    stop: async () => {
      if (!proc.killed) proc.kill('SIGTERM')
      await waitForExit(proc, opts.stopGraceMs ?? 1500)
      if (!proc.killed) proc.kill('SIGKILL')
    },
    waitForExit: (timeoutMs: number) => waitForExit(proc, timeoutMs),
  }

  proc.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim()
    if (text) console.error(`[${command}:stderr] ${text.slice(0, 500)}`)
  })

  return { proc, runBase }
}

export function waitForExit(proc: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve(false)
    }, timeoutMs)
    const onExit = () => {
      cleanup()
      resolve(true)
    }
    const cleanup = () => {
      clearTimeout(timer)
      proc.off('exit', onExit)
    }
    proc.once('exit', onExit)
  })
}
