/** Pure helpers for the Job description panel: the profile body as blocks, and a line diff. No HTML anywhere. */

export interface Block { type: 'h' | 'p' | 'li'; text: string }
export interface DiffLine { op: '+' | '-' | ' '; text: string }
export interface ProfileProblem { line?: number; field?: string; message: string }

/** Older servers omit line; keep their errors useful and clickable only when located. */
export function problemText(problem: ProfileProblem): string {
  return `${problem.line ? `line ${problem.line}: ` : ''}${problem.field ? `${problem.field}: ` : ''}${problem.message}`
}

/** Selection offsets use the original text, including CRLF bytes. Clamp beyond the final line. */
export function lineOffset(text: string, line: number): number {
  let offset = 0
  for (let n = 1; n < Math.max(1, Math.floor(line)); n++) {
    const next = text.indexOf('\n', offset)
    if (next < 0) return text.length
    offset = next + 1
  }
  return offset
}

/** The Markdown after the `---` frontmatter block (the whole text when there is none). */
export function bodyOf(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines[0] !== '---') return lines.join('\n')
  const end = lines.indexOf('---', 1)
  return end < 0 ? lines.join('\n') : lines.slice(end + 1).join('\n')
}

/** Headings (`# `), bullets (`- `/`* `) and paragraphs; the text stays raw, React escapes it when rendered. */
export function markdownToBlocks(text: string): Block[] {
  const out: Block[] = []
  let para: string[] = []
  const flush = () => { if (para.length) out.push({ type: 'p', text: para.join(' ') }); para = [] }
  for (const raw of bodyOf(text).split('\n')) {
    const line = raw.trim()
    const h = /^#{1,6}\s+(.*)$/.exec(line)
    const li = /^[-*]\s+(.*)$/.exec(line)
    if (!line) flush()
    else if (h) { flush(); out.push({ type: 'h', text: h[1] }) }
    else if (li) { flush(); out.push({ type: 'li', text: li[1] }) }
    else para.push(line)
  }
  flush()
  return out
}

/** Line diff (longest common subsequence): '-' only in `before`, '+' only in `after`. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n'); const b = after.split('\n')
  const t: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1])
  const out: DiffLine[] = []
  let i = 0; let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ op: ' ', text: a[i] }); i++; j++ }
    else if (t[i + 1][j] >= t[i][j + 1]) out.push({ op: '-', text: a[i++] })
    else out.push({ op: '+', text: b[j++] })
  }
  while (i < a.length) out.push({ op: '-', text: a[i++] })
  while (j < b.length) out.push({ op: '+', text: b[j++] })
  return out
}
