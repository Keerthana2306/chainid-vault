import { useMemo, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { Contract, JsonRpcProvider, type EventLog } from 'ethers'
import { contractAbi, contractAddress, labelFor } from '../lib/contract'
import { cleanAssetDescription, hashFile, parseDocumentFingerprint } from '../lib/documentFingerprint'

interface CustodyEvent {
  name: 'AssetMinted' | 'AssetTransferred'
  actor: string
  from: string | null
  to: string
  timestamp: number
  blockNumber: number
  logIndex: number
  transactionHash: string
}

interface VerificationRecord {
  name: string
  description: string
  tokenId: string
  issuer: string
  issuedAt: number
  owner: string
  ownerDid: string
  fingerprint: string | null
  lifecycleStatus: 'Valid' | 'Expiring soon' | 'Expired' | 'Revoked'
  expiresAt: number | null
  revokeReason: string | null
  timeline: CustodyEvent[]
}

interface VerifyPageProps {
  initialTokenId: string
}

const NODE_ERROR = 'Cannot reach the blockchain node. Run npm run node and npm run deploy:local'

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function displayAddress(address: string): string {
  return `${labelFor(address)} · ${shortAddress(address)}`
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(timestamp * 1000))
}

function isAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value)
}

export function VerifyPage({ initialTokenId }: VerifyPageProps) {
  const provider = useMemo(() => new JsonRpcProvider('http://127.0.0.1:8545'), [])
  const contract = useMemo(() => new Contract(contractAddress, contractAbi, provider), [provider])
  const [tokenId, setTokenId] = useState(initialTokenId)
  const [record, setRecord] = useState<VerificationRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileHash, setFileHash] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [hashingFile, setHashingFile] = useState(false)

  const loadRecord = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    const requestedTokenId = tokenId.trim()
    if (!/^\d+$/.test(requestedTokenId)) {
      setError('Enter a valid token ID.')
      setRecord(null)
      return
    }

    setLoading(true)
    setError(null)
    setRecord(null)
    try {
      await provider.getBlockNumber()
    } catch {
      setError(NODE_ERROR)
      setLoading(false)
      return
    }

    let currentOwner: string
    try {
      currentOwner = await contract.ownerOf(BigInt(requestedTokenId))
    } catch (ownerError) {
      const details = typeof ownerError === 'object' && ownerError !== null
        ? ownerError as { code?: string; shortMessage?: string }
        : {}
      if (details.code === 'CALL_EXCEPTION') {
        setError('No such asset')
      } else {
        setError(NODE_ERROR)
      }
      setLoading(false)
      return
    }

    try {
      const [asset, mintLogs, transferLogs, lifecycleStatus, expiry, revokedLogs, latestBlock] = await Promise.all([
        contract.getAsset(BigInt(requestedTokenId)),
        contract.queryFilter(contract.filters.AssetMinted(BigInt(requestedTokenId)), 0),
        contract.queryFilter(contract.filters.AssetTransferred(BigInt(requestedTokenId)), 0),
        contract.assetStatus(BigInt(requestedTokenId)),
        contract.expiryOf(BigInt(requestedTokenId)),
        contract.queryFilter(contract.filters.AssetRevoked(BigInt(requestedTokenId)), 0),
        provider.getBlock('latest'),
      ])
      if (!latestBlock) throw new Error('Could not load the latest block timestamp')
      const mintLog = mintLogs.find((log): log is EventLog => 'args' in log)
      if (!mintLog) {
        setError('No issuance event found for this asset.')
        return
      }

      const custodyLogs = [...mintLogs, ...transferLogs]
        .filter((log): log is EventLog => 'args' in log)
        .sort((left, right) => left.blockNumber - right.blockNumber || left.index - right.index)
      const timeline = await Promise.all(custodyLogs.map(async (log): Promise<CustodyEvent> => {
        const block = await provider.getBlock(log.blockNumber)
        if (!block) throw new Error(`Could not load block ${log.blockNumber}`)
        const isMint = log.fragment.name === 'AssetMinted'
        const actor = log.args.actor
        const from = isMint ? null : log.args.from
        const to = log.args.to
        if (!isAddress(actor) || !isAddress(to) || (from !== null && !isAddress(from))) {
          throw new Error(`Invalid custody event arguments for token ${requestedTokenId}`)
        }
        return {
          name: isMint ? 'AssetMinted' : 'AssetTransferred',
          actor,
          from,
          to,
          timestamp: block.timestamp,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          transactionHash: log.transactionHash,
        }
      }))

      const issuer = mintLog.args.actor
      if (!isAddress(issuer)) throw new Error('The issuance event does not contain a valid issuer address')
      const mintBlock = await provider.getBlock(mintLog.blockNumber)
      if (!mintBlock) throw new Error(`Could not load block ${mintLog.blockNumber}`)
      const ownerIdentity = await contract.getIdentity(currentOwner)
      const expiryTimestamp = Number(expiry)
      const status = Number(lifecycleStatus)
      const currentLifecycleStatus = status === 2
        ? 'Revoked'
        : status === 1
          ? 'Expired'
          : expiryTimestamp > 0 && expiryTimestamp - latestBlock.timestamp < 30 * 24 * 60 * 60
            ? 'Expiring soon'
            : 'Valid'
      const revokeLog = revokedLogs.find((log): log is EventLog => 'args' in log)

      setRecord({
        name: asset.name,
        description: cleanAssetDescription(asset.description),
        tokenId: requestedTokenId,
        issuer,
        issuedAt: mintBlock.timestamp,
        owner: currentOwner,
        ownerDid: ownerIdentity.did,
        fingerprint: parseDocumentFingerprint(asset.description),
        lifecycleStatus: currentLifecycleStatus,
        expiresAt: expiryTimestamp > 0 ? expiryTimestamp : null,
        revokeReason: revokeLog ? String(revokeLog.args.reason) : null,
        timeline,
      })
    } catch (loadError) {
      const details = typeof loadError === 'object' && loadError !== null
        ? loadError as { shortMessage?: string; message?: string }
        : {}
      setError(details.shortMessage ?? details.message ?? 'Could not load the verification record.')
    } finally {
      setLoading(false)
    }
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    setFileHash(null)
    setFileError(null)
    setHashingFile(true)
    try {
      setFileHash(await hashFile(file))
    } catch (hashError) {
      const message = hashError instanceof Error ? hashError.message : 'Could not hash the selected file.'
      setFileError(message)
    } finally {
      setHashingFile(false)
    }
  }

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    void handleFile(event.dataTransfer.files[0])
  }

  const selectedFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    void handleFile(event.target.files?.[0])
  }

  return (
    <main className="app-shell verify-page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Identity & Asset Registry home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M16 3.5 27 8v7.2c0 7.1-4.7 11.5-11 13.3C9.7 26.7 5 22.3 5 15.2V8l11-4.5Z" />
              <path d="m11.5 16 3 3 6-6" />
            </svg>
          </span>
          <span>Identity &amp; Asset Registry</span>
        </a>
        <nav className="verification-navigation" aria-label="Main navigation">
          <a className="button button-small button-quiet" href="/">Dashboard</a>
          <a className="button button-small button-primary" href="#/verify">Verify</a>
        </nav>
      </header>

      <section className="page-heading">
        <div>
          <p className="eyebrow">PUBLIC · READ-ONLY</p>
          <h1>Document authenticity verification</h1>
          <p className="heading-subtitle">Check an asset record and compare a certificate locally, without connecting a wallet.</p>
        </div>
        <div className="network-indicator"><span className="network-dot" />Hardhat Local</div>
      </section>

      <section className="verification-card" aria-labelledby="verification-heading">
        <div className="verification-section-heading">
          <p className="eyebrow">ON-CHAIN RECORD</p>
          <h2 id="verification-heading">Verify an asset</h2>
          <p>Enter a token ID or open a shared verification link.</p>
        </div>
        <form className="verification-form" onSubmit={(event) => void loadRecord(event)}>
          <label className="form-field">
            <span>Token ID</span>
            <input
              inputMode="numeric"
              onChange={(event) => setTokenId(event.target.value)}
              placeholder="e.g. 1"
              value={tokenId}
            />
          </label>
          <button className="button button-primary" disabled={loading} type="submit">
            {loading ? 'Verifying…' : 'Verify'}
          </button>
        </form>

        <label
          className="document-drop-zone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <span className="drop-zone-icon" aria-hidden="true">⇧</span>
          <strong>Drop the certificate file here</strong>
          <span>or choose a file to hash it locally in your browser</span>
          <input accept="*/*" onChange={selectedFileInput} type="file" />
        </label>
        {fileName && (
          <div className="selected-document" aria-live="polite">
            <strong>{fileName}</strong>
            {hashingFile ? <span>Hashing file locally…</span> : fileHash && <code>{fileHash}</code>}
          </div>
        )}
        {fileError && <div className="notice notice-error" role="alert">{fileError}</div>}
      </section>

      {error && <div className="notice notice-error verify-error" role="alert">{error}</div>}
      {record && (
        <>
          <section className={`lifecycle-banner lifecycle-${record.lifecycleStatus.toLowerCase().replaceAll(' ', '-')}`} aria-live="polite">
            <strong>Certificate status: {record.lifecycleStatus}</strong>
            <span>{record.expiresAt ? `Expires ${formatTime(record.expiresAt)}` : 'No expiry set'}</span>
            {record.lifecycleStatus === 'Revoked' && (
              <span>Revocation reason: {record.revokeReason || 'No reason recorded'}</span>
            )}
          </section>
          {record.fingerprint ? (
            fileHash && (
              <section
                className={`verification-result ${
                  fileHash === record.fingerprint &&
                  record.lifecycleStatus !== 'Revoked' &&
                  record.lifecycleStatus !== 'Expired'
                    ? 'is-authentic'
                    : 'is-tampered'
                }`}
                aria-live="polite"
              >
                <strong>
                  {fileHash === record.fingerprint
                    ? record.lifecycleStatus === 'Revoked'
                      ? 'File is authentic but this certificate is REVOKED'
                      : record.lifecycleStatus === 'Expired'
                        ? 'File is authentic but this certificate is EXPIRED'
                        : 'AUTHENTIC: file matches the on-chain record'
                    : 'TAMPERED: file does not match the on-chain record'}
                </strong>
                <div className="hash-comparison">
                  <span>File <code>{`${fileHash.slice(0, 12)}…${fileHash.slice(-8)}`}</code></span>
                  <span>On-chain <code>{`${record.fingerprint.slice(0, 12)}…${record.fingerprint.slice(-8)}`}</code></span>
                </div>
              </section>
            )
          ) : (
            <section className="verification-result is-unavailable" aria-live="polite">
              <strong>No document fingerprint on record</strong>
            </section>
          )}

          <section className="verification-record" aria-labelledby="record-heading">
            <div className="verification-section-heading">
              <p className="eyebrow">VERIFIED REGISTRY RECORD</p>
              <h2 id="record-heading">{record.name}</h2>
              <p>{record.description || 'No description provided.'}</p>
            </div>
            <dl className="record-details">
              <div><dt>Token ID</dt><dd>#{record.tokenId}</dd></div>
              <div><dt>Issued by</dt><dd>{displayAddress(record.issuer)}</dd></div>
              <div><dt>Issued at</dt><dd>{formatTime(record.issuedAt)}</dd></div>
              <div><dt>Current owner</dt><dd>{displayAddress(record.owner)}</dd></div>
              <div className="record-owner-did"><dt>Owner DID</dt><dd>{record.ownerDid || 'No DID registered'}</dd></div>
              {record.fingerprint && (
                <div className="record-fingerprint"><dt>Document fingerprint</dt><dd><code>{record.fingerprint}</code></dd></div>
              )}
            </dl>
            <section className="verification-timeline">
              <div className="audit-subheading">
                <div><p className="eyebrow">CUSTODY HISTORY</p><h3>Asset timeline</h3></div>
                <span className="count-label">{record.timeline.length} events</span>
              </div>
              {record.timeline.length ? (
                <ol className="asset-timeline">
                  {record.timeline.map((entry) => (
                    <li className="timeline-item" key={`${entry.transactionHash}-${entry.logIndex}`}>
                      <span className="timeline-marker" />
                      <div>
                        <strong>
                          {entry.name === 'AssetMinted'
                            ? `Minted by ${displayAddress(entry.actor)} to ${displayAddress(entry.to)}`
                            : `Transferred from ${entry.from ? displayAddress(entry.from) : '—'} to ${displayAddress(entry.to)}`}
                        </strong>
                        <time>{formatTime(entry.timestamp)}</time>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : <div className="audit-empty">No custody events found.</div>}
            </section>
            <p className="verification-admin-note">Only an Admin can issue assets, enforced by the contract.</p>
          </section>
        </>
      )}

      <footer className="page-footer">
        <span>Identity &amp; Asset Registry</span>
        <span>Public, read-only verification · No wallet required</span>
      </footer>
    </main>
  )
}
