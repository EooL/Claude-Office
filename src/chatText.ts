/** Presentation only: preserve the original row for approvals and storage. */
export function displayChatText(text: string): string {
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
}
