export function commentScopeId(documentId: string, threadId: string): string {
  return `comment:${documentId}:${threadId}`
}

