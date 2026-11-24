import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  ApiError,
  getSupabaseClient,
  parseTokenId,
  requireMethod,
  sendError,
  sendMethodNotAllowed,
} from './_shared.js'

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    requireMethod(req, 'GET')
    const queryTokenId = req.query.tokenId
    if (typeof queryTokenId !== 'string') {
      throw new ApiError(400, 'tokenId query parameter is required.')
    }
    const tokenId = parseTokenId(queryTokenId)
    const { data, error } = await getSupabaseClient()
      .from('asset_metadata')
      .select('title, description, updated_at')
      .eq('token_id', tokenId)
      .maybeSingle()

    if (error) {
      throw new ApiError(500, 'Could not retrieve asset metadata.')
    }
    if (!data) {
      throw new ApiError(404, 'Asset metadata was not found.')
    }

    res.status(200).json({
      title: data.title,
      description: data.description,
      updated_at: data.updated_at,
    })
  } catch (error) {
    if (error instanceof ApiError && error.status === 405) {
      sendMethodNotAllowed(res, 'GET')
      return
    }
    sendError(res, error)
  }
}
