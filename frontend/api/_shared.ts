import { Contract, isError, JsonRpcProvider, verifyMessage } from 'ethers'
import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import deployment from '../src/contract/deployment.json' with { type: 'json' }

const UINT256_MAX = (1n << 256n) - 1n
const SIGNATURE_MAX_AGE_SECONDS = 5 * 60
const CONTRACT_ABI = deployment.abi

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function sendError(res: VercelResponse, error: unknown): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message })
    return
  }

  res.status(500).json({ error: 'An unexpected server error occurred.' })
}

export function requireMethod(req: VercelRequest, method: 'GET' | 'POST'): void {
  if (req.method !== method) {
    throw new ApiError(405, 'Method not allowed.')
  }
}

export function getBody(req: VercelRequest): Record<string, unknown> {
  const body: unknown = req.body
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'Request body must be a JSON object.')
  }
  return body as Record<string, unknown>
}

export function parseTokenId(value: unknown): string {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'string' && !/^\d+$/.test(value)) ||
    (typeof value === 'number' && !Number.isSafeInteger(value))
  ) {
    throw new ApiError(400, 'tokenId must be a positive integer.')
  }

  let tokenId: bigint
  try {
    tokenId = BigInt(value)
  } catch {
    throw new ApiError(400, 'tokenId must be a positive integer.')
  }

  if (tokenId <= 0n || tokenId > UINT256_MAX) {
    throw new ApiError(400, 'tokenId must be a positive integer.')
  }
  return tokenId.toString()
}

function parseTimestamp(value: unknown): number {
  const timestampText =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === 'string' && /^\d+$/.test(value)
        ? value
        : null
  const timestamp = timestampText === null ? Number.NaN : Number(timestampText)

  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new ApiError(400, 'timestamp must be a Unix timestamp in seconds.')
  }

  const now = Math.floor(Date.now() / 1000)
  if (timestamp > now) {
    throw new ApiError(400, 'timestamp cannot be in the future.')
  }
  if (now - timestamp > SIGNATURE_MAX_AGE_SECONDS) {
    throw new ApiError(401, 'Signature has expired.')
  }
  return timestamp
}

export function requireString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new ApiError(400, `${field} must be a string of at most ${maxLength} characters.`)
  }
  return value
}

export function sanitizeFilename(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 255 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ||
    value === '.' ||
    value === '..'
  ) {
    throw new ApiError(400, 'filename must be a safe filename without path separators.')
  }
  return value
}

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new ApiError(500, 'Server configuration is incomplete.')
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}

export function getSupabaseClient() {
  return getSupabase()
}

function getChainConfig(): { rpcUrl: string; chainId: bigint } {
  const rpcUrl = process.env.RPC_URL
  const chainIdValue = process.env.CHAIN_ID
  if (!rpcUrl || !chainIdValue || !/^\d+$/.test(chainIdValue)) {
    throw new ApiError(500, 'Server configuration is incomplete.')
  }

  const chainId = BigInt(chainIdValue)
  if (chainId <= 0n || chainId !== BigInt(deployment.chainId)) {
    throw new ApiError(500, 'Server chain configuration does not match the deployment.')
  }
  return { rpcUrl, chainId }
}

export async function verifySignedRequest(
  action: 'upload' | 'download',
  body: Record<string, unknown>,
): Promise<{ tokenId: string; signerAddress: string }> {
  const tokenId = parseTokenId(body.tokenId)
  const timestamp = parseTimestamp(body.timestamp)
  const signature = requireString(body.signature, 'signature', 512)
  const { chainId } = getChainConfig()
  const message = `ChainID Vault|${action}|${tokenId}|${chainId}|${timestamp}`

  let signerAddress: string
  try {
    signerAddress = verifyMessage(message, signature).toLowerCase()
  } catch {
    throw new ApiError(401, 'Invalid signature.')
  }

  return { tokenId, signerAddress }
}

export async function authorizeAsset(
  tokenId: string,
  signerAddress: string,
): Promise<{ ownerAddress: string; sha256: string | null }> {
  const { rpcUrl, chainId } = getChainConfig()
  const provider = new JsonRpcProvider(rpcUrl)

  try {
    const network = await provider.getNetwork()
    if (network.chainId !== chainId) {
      throw new ApiError(503, 'RPC network does not match CHAIN_ID.')
    }

    const contract = new Contract(deployment.address, CONTRACT_ABI, provider)
    let owner: string
    try {
      owner = await contract.getFunction('ownerOf').staticCall(tokenId)
    } catch (error) {
      if (isError(error, 'CALL_EXCEPTION')) {
        throw new ApiError(404, 'Token was not found.')
      }
      throw error
    }

    const adminRole = await contract.getFunction('DEFAULT_ADMIN_ROLE').staticCall()
    const ownerAddress = owner.toLowerCase()
    const isAdmin: boolean = await contract
      .getFunction('hasRole')
      .staticCall(adminRole, signerAddress)

    if (ownerAddress !== signerAddress && !isAdmin) {
      throw new ApiError(403, 'Signer is not the token owner or an admin.')
    }

    const asset = await contract.getFunction('getAsset').staticCall(tokenId)
    const chainDescription =
      typeof asset.description === 'string' ? asset.description : String(asset[1] ?? '')
    const fingerprint = chainDescription.match(/sha256:([0-9a-f]{64})/i)?.[1]

    return {
      ownerAddress,
      sha256: fingerprint?.toLowerCase() ?? null,
    }
  } finally {
    provider.destroy()
  }
}

export function sendMethodNotAllowed(res: VercelResponse, method: 'GET' | 'POST'): void {
  res.setHeader('Allow', method)
  sendError(res, new ApiError(405, 'Method not allowed.'))
}
