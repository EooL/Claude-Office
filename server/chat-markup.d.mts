export interface ChatToken { kind: 'text' | 'code' | 'link' | 'image'; label: string; target?: string }
export function chatTokens(text: string): ChatToken[]
export function targetKind(target: string): 'web' | 'local' | null
