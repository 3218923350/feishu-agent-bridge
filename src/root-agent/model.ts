import { createHash, createHmac } from 'node:crypto'
import type { BridgeConfig } from '../config/schema.js'
import type { RootDecision } from './types.js'

export interface RootModel {
  decide(prompt: string): Promise<RootDecision>
}

export class NoopRootModel implements RootModel {
  async decide(): Promise<RootDecision> {
    return {
      action: 'ignore',
      score: 0,
      reason: 'root model disabled',
      memoryCandidates: [],
    }
  }
}

export class BedrockRootModel implements RootModel {
  constructor(private readonly config: BridgeConfig['root_agent']['model']) {}

  async decide(prompt: string): Promise<RootDecision> {
    const text = await this.invoke(prompt)
    const json = extractJson(text)
    return normalizeDecision(JSON.parse(json))
  }

  private async invoke(prompt: string): Promise<string> {
    const region = this.config.region
    const accessKeyId = resolveEnv(this.config.env?.AWS_ACCESS_KEY_ID) || process.env.AWS_ACCESS_KEY_ID
    const secretAccessKey = resolveEnv(this.config.env?.AWS_SECRET_ACCESS_KEY) || process.env.AWS_SECRET_ACCESS_KEY
    if (!accessKeyId || !secretAccessKey) throw new Error('missing AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY')

    const host = `bedrock-runtime.${region}.amazonaws.com`
    const path = `/model/${encodeURIComponent(this.config.model)}/converse`
    const body = JSON.stringify({
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: this.config.max_tokens },
    })
    const headers = signAws({
      method: 'POST',
      service: 'bedrock',
      region,
      host,
      path,
      body,
      accessKeyId,
      secretAccessKey,
    })
    const resp = await fetch(`https://${host}${path}`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body,
    })
    if (!resp.ok) throw new Error(`bedrock failed: ${resp.status} ${await resp.text()}`)
    const result = await resp.json() as any
    return (result.output?.message?.content ?? [])
      .map((part: any) => part.text ?? '')
      .join('\n')
      .trim()
  }
}

export function createRootModel(config: BridgeConfig): RootModel {
  if (config.root_agent.model.provider === 'bedrock') return new BedrockRootModel(config.root_agent.model)
  return new NoopRootModel()
}

export function normalizeDecision(value: any): RootDecision {
  const action = ['ignore', 'remember_only', 'dm_owner', 'reply', 'delegate'].includes(value?.action)
    ? value.action
    : 'ignore'
  const worker = value?.delegate?.worker === 'codex' ? 'codex' : 'claude'
  return {
    action,
    score: typeof value?.score === 'number' ? Math.max(0, Math.min(1, value.score)) : 0,
    reason: String(value?.reason ?? ''),
    reply: typeof value?.reply === 'string' ? value.reply : undefined,
    delegate: value?.delegate ? {
      worker,
      task: String(value.delegate.task ?? ''),
      expectedOutput: String(value.delegate.expectedOutput ?? ''),
    } : undefined,
    memoryCandidates: Array.isArray(value?.memoryCandidates) ? value.memoryCandidates.map(String).filter(Boolean) : [],
    todo: value?.todo?.text && value?.todo?.at ? { text: String(value.todo.text), at: String(value.todo.at) } : undefined,
  }
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1]!.trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return text
}

function resolveEnv(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match = value.match(/^\$\{([A-Z0-9_]+)\}$/)
  return match ? process.env[match[1]!] : value
}

function signAws(input: {
  method: string
  service: string
  region: string
  host: string
  path: string
  body: string
  accessKeyId: string
  secretAccessKey: string
}): Record<string, string> {
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256(input.body)
  const canonicalHeaders = `content-type:application/json\nhost:${input.host}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'content-type;host;x-amz-date'
  const canonicalRequest = [
    input.method,
    input.path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')
  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n')
  const signature = hmac(signingKey(input.secretAccessKey, dateStamp, input.region, input.service), stringToSign).toString('hex')
  return {
    host: input.host,
    'x-amz-date': amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

function signingKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}
