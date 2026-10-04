export function parseDocumentFingerprint(description: string): string | null {
  const match = description.match(/sha256:([0-9a-f]{64})/i)
  return match?.[1]?.toLowerCase() ?? null
}

export function cleanAssetDescription(description: string): string {
  return description.replace(/\s*\|\s*sha256:[0-9a-f]{64}\s*$/i, '').trim()
}

export async function hashFile(file: File): Promise<string> {
  const digest = await window.crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
