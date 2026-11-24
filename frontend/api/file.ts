import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  ApiError,
  authorizeAsset,
  getBody,
  getSupabaseClient,
  requireMethod,
  sanitizeFilename,
  sendError,
  sendMethodNotAllowed,
  verifySignedRequest,
} from './_shared.js'

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    requireMethod(req, 'POST')
    const { tokenId, signerAddress } = await verifySignedRequest('download', getBody(req))
    await authorizeAsset(tokenId, signerAddress)
    const supabase = getSupabaseClient()
    const { data: metadata, error: metadataError } = await supabase
      .from('asset_metadata')
      .select('filename, sha256')
      .eq('token_id', tokenId)
      .maybeSingle()

    if (metadataError) {
      throw new ApiError(500, 'Could not retrieve asset metadata.')
    }
    if (!metadata) {
      throw new ApiError(404, 'File metadata was not found.')
    }
    const filename = sanitizeFilename(metadata.filename)
    const path = `${tokenId}/${filename}`
    const { data: file, error: fileError } = await supabase.storage
      .from('documents')
      .createSignedUrl(path, 60)

    if (fileError || !file) {
      throw new ApiError(500, 'Could not create a signed download URL.')
    }

    res.status(200).json({ signedUrl: file.signedUrl, sha256: metadata.sha256 })
  } catch (error) {
    if (error instanceof ApiError && error.status === 405) {
      sendMethodNotAllowed(res, 'POST')
      return
    }
    sendError(res, error)
  }
}
