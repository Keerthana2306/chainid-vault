import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { JsonRpcProvider, type JsonRpcSigner } from 'ethers'
import {
  ADMIN,
  friendlyContractError,
  getContract,
} from '../lib/contract'
import {
  cleanAssetDescription,
  hashFile,
  parseDocumentFingerprint,
} from '../lib/documentFingerprint'
import {
  chainId,
  chainName,
  rpcUrl,
  tokenExplorerUrl,
} from '../lib/network'

interface AssetDetailPageProps {
  tokenId: string
  account: string | null
  signer: JsonRpcSigner | null
  walletChainId: bigint | null
  connectWallet: () => Promise<void>
  switchNetwork: () => Promise<void>
}

interface PublicMetadata {
  title: string
  description: string
  updated_at: string | null
}

interface OnChainAsset {
  name: string
  description: string
  fingerprint: string | null
}

interface VerificationResult {
  hash: string
  fingerprint: string | null
}

type AccessState =
  | 'checking'
  | 'allowed'
  | 'denied'
  | 'disconnected'
  | 'wrong-network'
  | 'unavailable'

interface MetadataState {
  tokenId: string
  metadata: PublicMetadata | null
  error: string | null
}

interface OnChainState {
  tokenId: string
  asset: OnChainAsset | null
  error: string | null
}

interface AccessCheck {
  tokenId: string
  account: string
  walletChainId: bigint
  status: AccessState
  error: string | null
}

interface AssetFeedback<T> {
  tokenId: string
  value: T
}

function normalizedTokenId(value: string): string | null {
  if (!/^\d+$/.test(value)) return null
  try {
    const tokenId = BigInt(value)
    return tokenId > 0n && tokenId < 1n << 256n ? tokenId.toString() : null
  } catch {
    return null
  }
}

async function readJson(response: Response): Promise<unknown> {
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `Request failed with status ${response.status}.`
    throw new Error(message)
  }
  return payload
}

function isPublicMetadata(value: unknown): value is PublicMetadata {
  if (typeof value !== 'object' || value === null || !('title' in value)) return false
  return (
    typeof value.title === 'string' &&
    'description' in value &&
    typeof value.description === 'string' &&
    'updated_at' in value &&
    (typeof value.updated_at === 'string' || value.updated_at === null)
  )
}

async function fetchPublicMetadata(tokenId: string): Promise<PublicMetadata | null> {
  const response = await fetch(`/api/metadata?tokenId=${encodeURIComponent(tokenId)}`)
  if (response.status === 404) return null
  const payload = await readJson(response)
  if (!isPublicMetadata(payload)) {
    throw new Error('The metadata response was invalid.')
  }
  return payload
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

async function signRequest(
  signer: JsonRpcSigner,
  account: string,
  action: 'upload' | 'download',
  tokenId: string,
): Promise<{ timestamp: number; signature: string }> {
  const signerAddress = await signer.getAddress()
  if (signerAddress.toLowerCase() !== account.toLowerCase()) {
    throw new Error('The active MetaMask account changed. Select the account again and retry.')
  }

  const timestamp = Math.floor(Date.now() / 1000)
  const message = `ChainID Vault|${action}|${tokenId}|${chainId}|${timestamp}`
  const signature = await signer.signMessage(message)
  return { timestamp, signature }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function AssetDetailPage({
  tokenId: requestedTokenId,
  account,
  signer,
  walletChainId,
  connectWallet,
  switchNetwork,
}: AssetDetailPageProps) {
  const tokenId = normalizedTokenId(requestedTokenId)
  const readProvider = useMemo(() => new JsonRpcProvider(rpcUrl, chainId), [])
  const [metadataState, setMetadataState] = useState<MetadataState | null>(null)
  const metadata =
    metadataState?.tokenId === tokenId ? metadataState.metadata : null
  const metadataError =
    tokenId === null
      ? 'The asset token ID is invalid.'
      : metadataState?.tokenId === tokenId
        ? metadataState.error
        : null
  const metadataLoading = Boolean(tokenId && metadataState?.tokenId !== tokenId)
  const [onChainState, setOnChainState] = useState<OnChainState | null>(null)
  const onChainAsset = onChainState?.tokenId === tokenId ? onChainState.asset : null
  const onChainError =
    tokenId === null
      ? 'The asset token ID is invalid.'
      : onChainState?.tokenId === tokenId
        ? onChainState.error
        : null
  const onChainLoading = Boolean(tokenId && onChainState?.tokenId !== tokenId)
  const [accessCheck, setAccessCheck] = useState<AccessCheck | null>(null)
  const matchingAccessCheck =
    tokenId &&
    account &&
    accessCheck?.tokenId === tokenId &&
    accessCheck.account === account.toLowerCase() &&
    accessCheck.walletChainId === walletChainId
      ? accessCheck
      : null
  const access: AccessState = !tokenId
    ? 'unavailable'
    : !account
      ? 'disconnected'
      : walletChainId !== BigInt(chainId)
        ? 'wrong-network'
        : matchingAccessCheck?.status ?? 'checking'
  const accessError = matchingAccessCheck?.error ?? null
  const [formValues, setFormValues] = useState<AssetFeedback<{
    title: string
    description: string
  }> | null>(null)
  const title =
    formValues?.tokenId === tokenId
      ? formValues.value.title
      : metadata?.title ?? onChainAsset?.name ?? ''
  const description =
    formValues?.tokenId === tokenId
      ? formValues.value.description
      : metadata?.description ?? cleanAssetDescription(onChainAsset?.description ?? '')
  const [selectedFileState, setSelectedFileState] = useState<AssetFeedback<File> | null>(null)
  const selectedFile = selectedFileState?.tokenId === tokenId ? selectedFileState.value : null
  const [uploadActivity, setUploadActivity] = useState<AssetFeedback<boolean> | null>(null)
  const uploading = uploadActivity?.tokenId === tokenId && uploadActivity.value
  const [uploadErrorState, setUploadErrorState] = useState<AssetFeedback<string> | null>(null)
  const uploadError = uploadErrorState?.tokenId === tokenId ? uploadErrorState.value : null
  const [uploadResultState, setUploadResultState] =
    useState<AssetFeedback<VerificationResult> | null>(null)
  const uploadResult = uploadResultState?.tokenId === tokenId ? uploadResultState.value : null
  const [downloadActivity, setDownloadActivity] = useState<AssetFeedback<boolean> | null>(null)
  const downloading = downloadActivity?.tokenId === tokenId && downloadActivity.value
  const [downloadErrorState, setDownloadErrorState] = useState<AssetFeedback<string> | null>(null)
  const downloadError = downloadErrorState?.tokenId === tokenId ? downloadErrorState.value : null
  const [downloadResultState, setDownloadResultState] =
    useState<AssetFeedback<VerificationResult> | null>(null)
  const downloadResult = downloadResultState?.tokenId === tokenId ? downloadResultState.value : null
  const metadataRequestId = useRef(0)
  const loadMetadata = useCallback(async () => {
    if (!tokenId) return
    const requestId = ++metadataRequestId.current
    try {
      const value = await fetchPublicMetadata(tokenId)
      if (requestId === metadataRequestId.current) {
        setMetadataState({ tokenId, metadata: value, error: null })
      }
    } catch (error) {
      if (requestId === metadataRequestId.current) {
        setMetadataState({
          tokenId,
          metadata: null,
          error: getErrorMessage(error, 'Could not load public metadata.'),
        })
      }
    }
  }, [tokenId])

  useEffect(() => {
    if (!tokenId) return
    const requestId = ++metadataRequestId.current
    let active = true
    void fetchPublicMetadata(tokenId).then((value) => {
      if (active && requestId === metadataRequestId.current) {
        setMetadataState({ tokenId, metadata: value, error: null })
      }
    }).catch((error: unknown) => {
      if (active && requestId === metadataRequestId.current) {
        setMetadataState({
          tokenId,
          metadata: null,
          error: getErrorMessage(error, 'Could not load public metadata.'),
        })
      }
    })
    return () => {
      active = false
      if (metadataRequestId.current === requestId) metadataRequestId.current += 1
    }
  }, [tokenId])

  useEffect(() => {
    let active = true
    if (!tokenId) return () => { active = false }

    const contract = getContract(readProvider)
    void contract.getAsset(BigInt(tokenId)).then((asset) => {
      if (!active) return
      const assetDescription = String(asset.description)
      setOnChainState({
        tokenId,
        asset: {
          name: String(asset.name),
          description: assetDescription,
          fingerprint: parseDocumentFingerprint(assetDescription),
        },
        error: null,
      })
    }).catch((error: unknown) => {
      if (active) {
        setOnChainState({
          tokenId,
          asset: null,
          error: friendlyContractError(error, contract),
        })
      }
    })

    return () => {
      active = false
    }
  }, [readProvider, tokenId])

  useEffect(() => {
    let active = true
    if (!tokenId || !account || walletChainId !== BigInt(chainId)) {
      return () => { active = false }
    }

    const contract = getContract(readProvider)
    void Promise.all([
      contract.ownerOf(BigInt(tokenId)),
      contract.hasRole(ADMIN, account),
    ]).then(([owner, isAdmin]) => {
      if (active) {
        setAccessCheck({
          tokenId,
          account: account.toLowerCase(),
          walletChainId,
          status: owner.toLowerCase() === account.toLowerCase() || Boolean(isAdmin)
            ? 'allowed'
            : 'denied',
          error: null,
        })
      }
    }).catch((error: unknown) => {
      if (active) {
        setAccessCheck({
          tokenId,
          account: account.toLowerCase(),
          walletChainId,
          status: 'unavailable',
          error: friendlyContractError(error, contract),
        })
      }
    })

    return () => {
      active = false
    }
  }, [account, readProvider, tokenId, walletChainId])

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!tokenId || !account || !signer || access !== 'allowed') return
    if (!selectedFile) {
      setUploadErrorState({ tokenId, value: 'Choose a document to upload.' })
      return
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(selectedFile.name)) {
      setUploadErrorState({
        tokenId,
        value: 'Use a filename with only letters, numbers, periods, underscores, and hyphens.',
      })
      return
    }
    if (!title.trim()) {
      setUploadErrorState({ tokenId, value: 'Enter a title for this document.' })
      return
    }

    setUploadActivity({ tokenId, value: true })
    setUploadErrorState(null)
    setUploadResultState(null)
    try {
      const localHash = await hashFile(selectedFile)
      const { timestamp, signature } = await signRequest(signer, account, 'upload', tokenId)
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId,
          title: title.trim(),
          description,
          filename: selectedFile.name,
          timestamp,
          signature,
        }),
      })
      const payload = await readJson(response)
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('signedUrl' in payload) ||
        typeof payload.signedUrl !== 'string'
      ) {
        throw new Error('The upload URL response was invalid.')
      }

      const uploadResponse = await fetch(payload.signedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': selectedFile.type || 'application/octet-stream',
          'cache-control': 'max-age=3600',
          'x-upsert': 'false',
        },
        body: selectedFile,
      })
      if (!uploadResponse.ok) {
        throw new Error('Supabase rejected the document upload.')
      }

      setUploadResultState({
        tokenId,
        value: {
          hash: localHash,
          fingerprint: onChainAsset?.fingerprint ?? null,
        },
      })
      await loadMetadata()
    } catch (error) {
      setUploadErrorState({
        tokenId,
        value: getErrorMessage(error, 'Could not upload the document.'),
      })
    } finally {
      setUploadActivity((current) =>
        current?.tokenId === tokenId ? { tokenId, value: false } : current,
      )
    }
  }

  const handleDownload = async () => {
    if (!tokenId || !account || !signer || access !== 'allowed') return

    setDownloadActivity({ tokenId, value: true })
    setDownloadErrorState(null)
    setDownloadResultState(null)
    try {
      const { timestamp, signature } = await signRequest(signer, account, 'download', tokenId)
      const response = await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId, timestamp, signature }),
      })
      const payload = await readJson(response)
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('signedUrl' in payload) ||
        typeof payload.signedUrl !== 'string' ||
        !('filename' in payload) ||
        typeof payload.filename !== 'string'
      ) {
        throw new Error('The download URL response was invalid.')
      }
      const filename = payload.filename

      const fileResponse = await fetch(payload.signedUrl)
      if (!fileResponse.ok) {
        throw new Error('Could not download the document from storage.')
      }

      const blob = await fileResponse.blob()
      const localHash = await hashFile(blob)
      downloadBlob(blob, filename)
      setDownloadResultState({
        tokenId,
        value: {
          hash: localHash,
          fingerprint: onChainAsset?.fingerprint ?? null,
        },
      })
    } catch (error) {
      setDownloadErrorState({
        tokenId,
        value: getErrorMessage(error, 'Could not download and verify the document.'),
      })
    } finally {
      setDownloadActivity((current) =>
        current?.tokenId === tokenId ? { tokenId, value: false } : current,
      )
    }
  }

  const networkMatches = walletChainId === BigInt(chainId)
  const controlsVisible = access === 'allowed' && Boolean(account && signer)

  return (
    <main className="app-shell verify-page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="ChainID Vault home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M16 3.5 27 8v7.2c0 7.1-4.7 11.5-11 13.3C9.7 26.7 5 22.3 5 15.2V8l11-4.5Z" />
              <path d="m11.5 16 3 3 6-6" />
            </svg>
          </span>
          <span>ChainID Vault</span>
        </a>
        <nav className="verification-navigation" aria-label="Main navigation">
          <a className="button button-small button-quiet" href="/">Dashboard</a>
          <a className="button button-small button-quiet" href={`#/verify/${tokenId ?? requestedTokenId}`}>
            Verify
          </a>
          {account ? (
            <span className="wallet-disconnected">{`${account.slice(0, 6)}...${account.slice(-4)}`}</span>
          ) : (
            <button className="button button-primary" onClick={() => void connectWallet()} type="button">
              Connect wallet
            </button>
          )}
        </nav>
      </header>

      <section className="page-heading">
        <div>
          <p className="eyebrow">ASSET DETAILS</p>
          <h1>
            {tokenExplorerUrl(tokenId ?? '')
              ? <a href={tokenExplorerUrl(tokenId ?? '') ?? undefined} rel="noreferrer" target="_blank">Asset #{tokenId}</a>
              : `Asset #${tokenId ?? requestedTokenId}`}
          </h1>
          <p className="heading-subtitle">Public metadata and private document access.</p>
        </div>
        <div className="network-indicator">
          <span className={`network-dot ${networkMatches ? 'is-online' : ''}`} />
          {chainName}
        </div>
      </section>

      {metadataError && <div className="notice notice-error" role="alert">{metadataError}</div>}
      {onChainError && <div className="notice notice-error" role="alert">{onChainError}</div>}

      <section className="verification-record" aria-labelledby="public-metadata-heading">
        <div className="verification-section-heading">
          <p className="eyebrow">PUBLIC METADATA</p>
          <h2 id="public-metadata-heading">
            {metadata?.title ?? (metadataLoading ? 'Loading metadata…' : 'No public metadata yet')}
          </h2>
          <p>
            {metadata
              ? metadata.description || 'No description provided.'
              : metadataLoading
                ? 'Loading title and description.'
                : 'Upload a document to add public title and description metadata.'}
          </p>
        </div>
        <dl className="record-details">
          <div><dt>Token ID</dt><dd>#{tokenId ?? requestedTokenId}</dd></div>
          {metadata?.updated_at && (
            <div><dt>Metadata updated</dt><dd>{new Date(metadata.updated_at).toLocaleString()}</dd></div>
          )}
          <div className="record-fingerprint">
            <dt>On-chain SHA-256 fingerprint</dt>
            <dd>
              {onChainLoading
                ? 'Loading fingerprint…'
                : onChainAsset?.fingerprint
                  ? <code>{onChainAsset.fingerprint}</code>
                  : 'No fingerprint recorded'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="verification-card asset-document-panel" aria-labelledby="document-actions-heading">
        <div className="verification-section-heading">
          <p className="eyebrow">PRIVATE DOCUMENT</p>
          <h2 id="document-actions-heading">Document access</h2>
          <p>Files are stored privately. The owner or an Admin must sign each request.</p>
        </div>

        {access === 'checking' && (
          <p className="asset-access-status" role="status">Checking token ownership and Admin role…</p>
        )}
        {access === 'disconnected' && (
          <p className="asset-access-status">Connect the token owner or an Admin wallet to access document controls.</p>
        )}
        {access === 'wrong-network' && (
          <div className="notice notice-warning" role="status">
            <span>Switch MetaMask to {chainName} to check access.</span>
            <button className="button button-small" onClick={() => void switchNetwork()} type="button">
              Switch network
            </button>
          </div>
        )}
        {access === 'denied' && (
          <p className="asset-access-status">Document controls are available only to the token owner or an Admin.</p>
        )}
        {accessError && <div className="notice notice-error" role="alert">{accessError}</div>}
        {access === 'unavailable' && !accessError && (
          <p className="asset-access-status">Document access could not be checked.</p>
        )}
        {access === 'allowed' && !signer && (
          <p className="asset-access-status">Select an active MetaMask account to sign document requests.</p>
        )}

        {controlsVisible && (
          <div className="asset-document-controls">
            <form className="asset-document-form" onSubmit={(event) => void handleUpload(event)}>
              <h3>Upload document</h3>
              <label className="form-field">
                <span>Title</span>
                <input
                  maxLength={200}
                  onChange={(event) => setFormValues({
                    tokenId: tokenId ?? '',
                    value: { title: event.target.value, description },
                  })}
                  required
                  value={title}
                />
              </label>
              <label className="form-field">
                <span>Description</span>
                <textarea
                  maxLength={10000}
                  onChange={(event) => setFormValues({
                    tokenId: tokenId ?? '',
                    value: { title, description: event.target.value },
                  })}
                  value={description}
                />
              </label>
              <label className="form-field">
                <span>Document</span>
                <input
                  key={tokenId}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    setSelectedFileState(file && tokenId ? { tokenId, value: file } : null)
                    setUploadErrorState(null)
                    setUploadResultState(null)
                  }}
                  type="file"
                />
              </label>
              <p className="form-hint">The SHA-256 hash is computed locally before upload.</p>
              {uploadError && <div className="notice notice-error" role="alert">{uploadError}</div>}
              <button
                className="button button-primary"
                disabled={uploading || downloading || onChainLoading || !selectedFile}
                type="submit"
              >
                {uploading ? 'Signing and uploading…' : 'Upload document'}
              </button>
              {uploadResult && (
                <div
                  className={`verification-result ${
                    uploadResult.fingerprint === null
                      ? 'is-unavailable'
                      : uploadResult.hash === uploadResult.fingerprint
                        ? 'is-authentic'
                        : 'is-tampered'
                  }`}
                  aria-live="polite"
                  role={uploadResult.fingerprint !== null && uploadResult.hash !== uploadResult.fingerprint ? 'alert' : 'status'}
                >
                  <strong>
                    {uploadResult.fingerprint === null
                      ? 'Upload complete · no on-chain fingerprint to compare'
                      : uploadResult.hash === uploadResult.fingerprint
                        ? 'Upload complete · Verified'
                        : 'Upload complete · Tampered or mismatched'}
                  </strong>
                  <div className="hash-comparison">
                    <span>File <code>{uploadResult.hash}</code></span>
                    {uploadResult.fingerprint && (
                      <span>On-chain <code>{uploadResult.fingerprint}</code></span>
                    )}
                  </div>
                </div>
              )}
            </form>

            <div className="asset-download-panel">
              <h3>Download and verify</h3>
              <p>Downloads the private document and compares its SHA-256 hash with the on-chain fingerprint.</p>
              {downloadError && <div className="notice notice-error" role="alert">{downloadError}</div>}
              <button
                className="button button-quiet"
                disabled={downloading || uploading || onChainLoading}
                onClick={() => void handleDownload()}
                type="button"
              >
                {downloading ? 'Signing, downloading, and verifying…' : 'Download and verify'}
              </button>
              {downloadResult && (
                <div
                  className={`verification-result ${
                    downloadResult.fingerprint === null
                      ? 'is-unavailable'
                      : downloadResult.hash === downloadResult.fingerprint
                        ? 'is-authentic'
                        : 'is-tampered'
                  }`}
                  aria-live="polite"
                  role={downloadResult.fingerprint !== null && downloadResult.hash !== downloadResult.fingerprint ? 'alert' : 'status'}
                >
                  <strong>
                    {downloadResult.fingerprint === null
                      ? 'No on-chain fingerprint; unable to verify.'
                      : downloadResult.hash === downloadResult.fingerprint
                        ? 'Verified'
                        : 'Tampered or mismatched'}
                  </strong>
                  <div className="hash-comparison">
                    <span>Downloaded file <code>{downloadResult.hash}</code></span>
                    {downloadResult.fingerprint && (
                      <span>On-chain <code>{downloadResult.fingerprint}</code></span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <footer className="page-footer">
        <span>ChainID Vault</span>
        <span>{chainName} · Public asset metadata · Private documents</span>
      </footer>
    </main>
  )
}
