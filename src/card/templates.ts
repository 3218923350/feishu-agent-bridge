export function textCard(title: string, content: string): object {
  return {
    schema: '2.0',
    header: { title: { tag: 'plain_text', content: title } },
    body: { elements: [{ tag: 'markdown', content }] },
  }
}

export function helpCard(): object {
  return textCard('feishu-agent-bridge', [
    '/new - reset current topic',
    '/stop - stop active run',
    '/review <query> - ask Codex review track',
    '/debate <query> - start Claude/Codex debate',
    '/cd <path> - set private navigation cwd',
    '/ws list|save|use|remove - manage workspaces',
    '/invite user @user - allow DM usage',
    '/invite group - allow current group',
  ].join('\n'))
}

export function serializeCard(card: object): string {
  return JSON.stringify(card)
}

