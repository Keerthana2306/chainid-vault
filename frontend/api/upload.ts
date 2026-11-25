import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  ApiError,
  authorizeAsset,
  getBody,
  getSupabaseClient,
  requireMethod,
  requireString,
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
    const body = getBody(req)
    const { tokenId, signerAddress } = await verifySignedRequest('upload', body)
    const title = requireString(body.title, 'title', 200).trim()
    const description = requireString(body.description, 'description', 10000)
    const filename = sanitizeFilename(body.filename)

    if (!title) {
      throw new ApiError(400, 'title must not be empty.')
    }

    const { ownerAddress, sha256 } = await authorizeAsset(tokenId, signerAddress)
    const supabase = getSupabaseClient()
    const path = `${tokenId}/${filename}`
    const { data: upload, error: uploadError } = await supabase.storage
      .from('documents')
      .createSignedUploadUrl(path)

    if (uploadError) {
      console.error('signed upload URL failed', {
        code: uploadError.code,
        message: uploadError.message,
      })
      throw new ApiError(500, 'Could not create a signed upload URL.')
    }
    if (!upload) {
      throw new ApiError(500, 'Could not create a signed upload URL.')
    }

    const { error: metadataError } = await supabase.from('asset_metadata').upsert(
      {
        token_id: tokenId,
        title,
        description,
        filename,
        owner_address: ownerAddress,
        sha256,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token_id' },
    )

    if (metadataError) {
      console.error('upsert failed', {
        code: metadataError.code,
        message: metadataError.message,
      })
      throw new ApiError(500, 'Could not save asset metadata.')
    }

    res.status(200).json({ signedUrl: upload.signedUrl, path })
  } catch (error) {
    if (error instanceof ApiError && error.status === 405) {
      sendMethodNotAllowed(res, 'POST')
      return
    }
    sendError(res, error)
  }
}
