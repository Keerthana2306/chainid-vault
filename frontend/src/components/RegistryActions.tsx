import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { isAddress, type BrowserProvider, type ContractTransactionResponse, type JsonRpcSigner } from 'ethers'
import { accounts, didFor, friendlyContractError, getContract, labelFor, roleHashes } from '../lib/contract'
import { AuditTrail } from './AuditTrail'
import { cleanAssetDescription, hashFile } from '../lib/documentFingerprint'

interface OwnedAsset {
  tokenId: string
  name: string
}

interface RegistryActionsProps {
  account: string
  provider: BrowserProvider
  signer: JsonRpcSigner | null
  verified: boolean
  assets: OwnedAsset[]
  refreshSignal: number
  requestAccountFallback: (label: string) => Promise<void>
  onSuccess: () => Promise<void>
}

type Panel = 'identity' | 'roles' | 'assets' | 'audit'
type ActivityStatus = 'pending' | 'success' | 'failed'

interface ActivityEntry {
  id: number
  action: string
  status: ActivityStatus
  message: string
  createdAt: string
}

interface ActionPanelProps {
  title: string
  requirement: string
  verified: boolean
  children: ReactNode
}

interface ContractError extends Error {
  code?: string | number
  data?: unknown
  shortMessage?: string
  error?: { data?: unknown }
  info?: { error?: { data?: unknown } }
}

function ActionPanel({ title, requirement, verified, children }: ActionPanelProps) {
  return (
    <section className="action-panel">
      <header className="action-panel-heading">
        <h3>{title}</h3>
        <span className="requirement-label">Requires: {requirement}</span>
      </header>
      {!verified && <p className="signin-hint">Sign in with your DID first</p>}
      <fieldset className="action-controls" disabled={!verified}>
        {children}
      </fieldset>
    </section>
  )
}

function DemoAccountButtons({
  onSelect,
  label,
}: {
  onSelect: (address: string) => void
  label: string
}) {
  return (
    <fieldset className="quick-fill">
      <legend>{label}</legend>
      <div className="quick-fill-buttons">
        {accounts.map((demoAccount) => (
          <button
            className="quick-fill-button"
            key={demoAccount.address}
            onClick={() => onSelect(demoAccount.address)}
            type="button"
          >
            {demoAccount.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`
}

export function RegistryActions({
  account,
  provider,
  signer,
  verified,
  assets,
  refreshSignal,
  requestAccountFallback,
  onSuccess,
}: RegistryActionsProps) {
  const [panel, setPanel] = useState<Panel>('identity')
  const [pending, setPending] = useState<string | null>(null)
  const [auditRefreshSignal, setAuditRefreshSignal] = useState(0)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [registerAddress, setRegisterAddress] = useState('')
  const [revokeAddress, setRevokeAddress] = useState('')
  const [revokeConfirmed, setRevokeConfirmed] = useState(false)
  const [assignAddress, setAssignAddress] = useState('')
  const [assignRole, setAssignRole] = useState<keyof typeof roleHashes>('Manager')
  const [revokeRoleAddress, setRevokeRoleAddress] = useState('')
  const [revokeRole, setRevokeRole] = useState<keyof typeof roleHashes>('Manager')
  const [mintAddress, setMintAddress] = useState('')
  const [mintName, setMintName] = useState('')
  const [mintDescription, setMintDescription] = useState('')
  const [mintFile, setMintFile] = useState<File | null>(null)
  const [mintFingerprint, setMintFingerprint] = useState<string | null>(null)
  const [mintFileError, setMintFileError] = useState<string | null>(null)
  const [hashingMintFile, setHashingMintFile] = useState(false)
  const mintFileRequest = useRef(0)
  const [transferTokenId, setTransferTokenId] = useState('')
  const [transferAddress, setTransferAddress] = useState('')

  const recordAction = async (
    action: string,
    send: (contract: ReturnType<typeof getContract>) => Promise<ContractTransactionResponse>,
  ) => {
    const id = Date.now() + Math.random()
    setPending(action)
    setActivity((entries) => [{
      id,
      action,
      status: 'pending',
      message: 'Waiting for MetaMask...',
      createdAt: new Date().toLocaleTimeString(),
    }, ...entries])

    try {
      if (!signer) {
        throw Object.assign(new Error('Connect a wallet on the Hardhat Local network first'), {
          shortMessage: 'Connect a wallet on the Hardhat Local network first',
        })
      }
      const contract = getContract(signer)
      const transaction = await send(contract)
      setActivity((entries) => entries.map((entry) =>
        entry.id === id ? { ...entry, message: 'Confirming...' } : entry,
      ))
      const receipt = await transaction.wait()
      if (!receipt) throw new Error('Transaction was not confirmed')
      const message = `Confirmed · ${shortHash(transaction.hash)}`
      setActivity((entries) => entries.map((entry) =>
        entry.id === id ? { ...entry, status: 'success', message } : entry,
      ))
      await onSuccess()
      setAuditRefreshSignal((signal) => signal + 1)
    } catch (error) {
      if (isAccountSelectionRejection(error)) {
        void requestAccountFallback(labelFor(account))
      }
      const friendlyMessage = friendlyContractError(
        error as ContractError,
        signer ? getContract(signer) : null,
      )
      setActivity((entries) => entries.map((entry) =>
        entry.id === id ? { ...entry, status: 'failed', message: friendlyMessage } : entry,
      ))
    } finally {
      setPending(null)
    }
  }

  const submitAddress = (
    event: FormEvent<HTMLFormElement>,
    address: string,
    action: string,
    send: (contract: ReturnType<typeof getContract>, validAddress: string) => Promise<ContractTransactionResponse>,
  ) => {
    event.preventDefault()
    if (!isAddress(address)) {
      return recordAction(action, async () => {
        throw Object.assign(new Error('Enter a valid wallet address'), {
          shortMessage: 'Enter a valid wallet address',
        })
      })
    }
    const validAddress = address
    return recordAction(action, (contract) => send(contract, validAddress))
  }

  const activityLog = (
    <section className="activity-panel" aria-labelledby="recent-activity-heading">
      <div className="activity-heading">
        <div>
          <p className="eyebrow">THIS SESSION</p>
          <h2 id="recent-activity-heading">Recent activity</h2>
        </div>
        <span className="count-label">{activity.length} {activity.length === 1 ? 'attempt' : 'attempts'}</span>
      </div>
      {activity.length ? (
        <ul className="activity-list">
          {activity.map((entry) => (
            <li className="activity-item" key={entry.id}>
              <div className="activity-copy">
                <strong>{entry.action}</strong>
                <span>{entry.message}</span>
              </div>
              <div className="activity-meta">
                <time>{entry.createdAt}</time>
                <span className={`activity-badge activity-${entry.status}`}>
                  {entry.status === 'success' ? 'Success' : entry.status === 'failed' ? 'Failed' : entry.message}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="activity-empty">Actions attempted during this session will appear here.</div>
      )}
    </section>
  )

  return (
    <section className="registry-actions">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ON-CHAIN ACTIONS</p>
          <h2>Manage registry</h2>
        </div>
        <span className="count-label">Calls are enforced by the contract</span>
      </div>

      <nav className="action-tabs" aria-label="Registry action panels">
        {([
          ['identity', 'Identity'],
          ['roles', 'Roles'],
          ['assets', 'Assets'],
          ['audit', 'Audit Trail'],
        ] as const).map(([id, label]) => (
          <button
            aria-current={panel === id ? 'page' : undefined}
            className={`action-tab ${panel === id ? 'is-selected' : ''}`}
            key={id}
            onClick={() => setPanel(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="action-content">
        {panel === 'identity' && (
          <div className="action-grid">
            <ActionPanel title="Register identity" requirement="Admin or Manager" verified={verified}>
              <form onSubmit={(event) => submitAddress(
                event,
                registerAddress,
                'Register identity',
                (contract, address) => contract.registerIdentity(address, didFor(address)),
              )}>
                <label className="form-field">
                  <span>Wallet address</span>
                  <input
                    autoComplete="off"
                    onChange={(event) => setRegisterAddress(event.target.value)}
                    placeholder="0x..."
                    value={registerAddress}
                  />
                </label>
                <DemoAccountButtons label="Quick fill demo account" onSelect={setRegisterAddress} />
                <p className="form-hint">DID is generated automatically from the lowercase wallet address.</p>
                <button className="button button-primary" disabled={pending !== null} type="submit">
                  {pending === 'Register identity' ? pendingLabel(activity) : 'Register identity'}
                </button>
              </form>
            </ActionPanel>

            <ActionPanel title="Revoke identity" requirement="Admin" verified={verified}>
              <form onSubmit={(event) => {
                event.preventDefault()
                if (!revokeConfirmed) {
                  return recordAction('Revoke identity', async () => {
                    throw Object.assign(new Error('Confirm that this is permanent before revoking'), {
                      shortMessage: 'Confirm that this is permanent before revoking',
                    })
                  })
                }
                return submitAddress(
                  event,
                  revokeAddress,
                  'Revoke identity',
                  (contract, address) => contract.revokeIdentity(address),
                )
              }}>
                <label className="form-field">
                  <span>Wallet address</span>
                  <input
                    autoComplete="off"
                    onChange={(event) => setRevokeAddress(event.target.value)}
                    placeholder="0x..."
                    value={revokeAddress}
                  />
                </label>
                <DemoAccountButtons label="Quick fill demo account" onSelect={setRevokeAddress} />
                <label className="confirm-check">
                  <input
                    checked={revokeConfirmed}
                    onChange={(event) => setRevokeConfirmed(event.target.checked)}
                    type="checkbox"
                  />
                  <span>This is permanent. The identity cannot be restored.</span>
                </label>
                <button className="button button-danger" disabled={pending !== null} type="submit">
                  {pending === 'Revoke identity' ? pendingLabel(activity) : 'Revoke identity'}
                </button>
              </form>
            </ActionPanel>
          </div>
        )}

        {panel === 'audit' && (
          <AuditTrail provider={provider} refreshSignal={refreshSignal + auditRefreshSignal} />
        )}

        {panel === 'roles' && (
          <div className="action-grid">
            <ActionPanel title="Assign role" requirement="Admin" verified={verified}>
              <form onSubmit={(event) => submitAddress(
                event,
                assignAddress,
                'Assign role',
                (contract, address) => contract.assignRole(address, roleHashes[assignRole]),
              )}>
                <label className="form-field">
                  <span>Wallet address</span>
                  <input
                    autoComplete="off"
                    onChange={(event) => setAssignAddress(event.target.value)}
                    placeholder="0x..."
                    value={assignAddress}
                  />
                </label>
                <DemoAccountButtons label="Quick fill demo account" onSelect={setAssignAddress} />
                <label className="form-field">
                  <span>Role to assign</span>
                  <select onChange={(event) => setAssignRole(event.target.value as keyof typeof roleHashes)} value={assignRole}>
                    {Object.keys(roleHashes).map((role) => <option key={role}>{role}</option>)}
                  </select>
                </label>
                <button className="button button-primary" disabled={pending !== null} type="submit">
                  {pending === 'Assign role' ? pendingLabel(activity) : 'Assign role'}
                </button>
              </form>
            </ActionPanel>

            <ActionPanel title="Revoke role" requirement="Admin" verified={verified}>
              <form onSubmit={(event) => submitAddress(
                event,
                revokeRoleAddress,
                'Revoke role',
                (contract, address) => contract.revokeRole(roleHashes[revokeRole], address),
              )}>
                <label className="form-field">
                  <span>Wallet address</span>
                  <input
                    autoComplete="off"
                    onChange={(event) => setRevokeRoleAddress(event.target.value)}
                    placeholder="0x..."
                    value={revokeRoleAddress}
                  />
                </label>
                <DemoAccountButtons label="Quick fill demo account" onSelect={setRevokeRoleAddress} />
                <label className="form-field">
                  <span>Role to revoke</span>
                  <select onChange={(event) => setRevokeRole(event.target.value as keyof typeof roleHashes)} value={revokeRole}>
                    {Object.keys(roleHashes).map((role) => <option key={role}>{role}</option>)}
                  </select>
                </label>
                <button className="button button-danger" disabled={pending !== null} type="submit">
                  {pending === 'Revoke role' ? pendingLabel(activity) : 'Revoke role'}
                </button>
              </form>
            </ActionPanel>
          </div>
        )}

        {panel === 'assets' && (
          <div className="action-grid">
            <ActionPanel title="Issue asset record (NFT)" requirement="Admin" verified={verified}>
              <form onSubmit={(event) => {
                if (mintFile && !mintFingerprint) {
                  event.preventDefault()
                  return
                }
                const description = mintFingerprint
                  ? `${cleanAssetDescription(mintDescription)} | sha256:${mintFingerprint}`
                  : mintDescription
                return submitAddress(
                  event,
                  mintAddress,
                  'Issue asset record (NFT)',
                  (contract, address) => contract.mintAsset(address, mintName, description),
                )
              }}>
                <label className="form-field">
                  <span>Recipient address</span>
                  <input
                    autoComplete="off"
                    onChange={(event) => setMintAddress(event.target.value)}
                    placeholder="0x..."
                    value={mintAddress}
                  />
                </label>
                <DemoAccountButtons label="Quick fill demo account" onSelect={setMintAddress} />
                <label className="form-field">
                  <span>Name</span>
                  <input onChange={(event) => setMintName(event.target.value)} placeholder="Asset name" value={mintName} />
                </label>
                <label className="form-field">
                  <span>Description</span>
                  <textarea
                    onChange={(event) => setMintDescription(event.target.value)}
                    placeholder="Describe the asset"
                    rows={3}
                    value={mintDescription}
                  />
                </label>
                <label className="form-field">
                  <span>Attach document (optional)</span>
                  <input
                    accept="*/*"
                    onChange={async (event) => {
                      const file = event.target.files?.[0] ?? null
                      const request = ++mintFileRequest.current
                      setMintFile(file)
                      setMintFingerprint(null)
                      setMintFileError(null)
                      if (!file) {
                        setHashingMintFile(false)
                        return
                      }
                      setHashingMintFile(true)
                      try {
                        const fingerprint = await hashFile(file)
                        if (request === mintFileRequest.current) setMintFingerprint(fingerprint)
                      } catch (error) {
                        if (request === mintFileRequest.current) {
                          setMintFileError(error instanceof Error ? error.message : 'Could not hash the selected file.')
                        }
                      } finally {
                        if (request === mintFileRequest.current) setHashingMintFile(false)
                      }
                    }}
                    type="file"
                  />
                </label>
                {hashingMintFile && <p className="form-hint">Hashing document in your browser…</p>}
                {mintFingerprint && <p className="fingerprint-preview"><span>SHA-256 fingerprint</span><code>{mintFingerprint}</code></p>}
                {mintFileError && <p className="form-error" role="alert">{mintFileError}</p>}
                <p className="form-hint">Only the fingerprint goes on-chain. The file never leaves your browser.</p>
                <button
                  className="button button-primary"
                  disabled={pending !== null || hashingMintFile || Boolean(mintFile && !mintFingerprint)}
                  type="submit"
                >
                  {pending === 'Issue asset record (NFT)' ? pendingLabel(activity) : 'Issue asset record (NFT)'}
                </button>
              </form>
            </ActionPanel>

            <ActionPanel title="Hand over custody (NFT transfer)" requirement="NFT owner (User role)" verified={verified}>
              <form onSubmit={(event) => submitAddress(
                event,
                transferAddress,
                'Hand over custody (NFT transfer)',
                (contract, address) => {
                  const tokenId = transferTokenId || assets[0]?.tokenId
                  if (!tokenId) {
                    throw Object.assign(new Error('Select an NFT owned by this account'), {
                      shortMessage: 'Select an NFT owned by this account',
                    })
                  }
                  return contract.transferFrom(account, address, BigInt(tokenId))
                },
              )}>
                <label className="form-field">
                  <span>Your NFT</span>
                  <select
                    onChange={(event) => setTransferTokenId(event.target.value)}
                    value={transferTokenId || assets[0]?.tokenId || ''}
                  >
                    {assets.length === 0 && <option value="">No owned NFTs</option>}
                    {assets.map((asset) => (
                      <option key={asset.tokenId} value={asset.tokenId}>
                        #{asset.tokenId} · {asset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Recipient address</span>
                  <input
                    autoComplete="off"
                    onChange={(event) => setTransferAddress(event.target.value)}
                    placeholder="0x..."
                    value={transferAddress}
                  />
                </label>
                <DemoAccountButtons label="Quick fill demo account" onSelect={setTransferAddress} />
                <button className="button button-primary" disabled={pending !== null} type="submit">
                  {pending === 'Hand over custody (NFT transfer)' ? pendingLabel(activity) : 'Hand over custody (NFT transfer)'}
                </button>
              </form>
            </ActionPanel>
          </div>
        )}
      </div>

      {activityLog}
    </section>
  )
}

function pendingLabel(activity: ActivityEntry[]): string {
  const latest = activity[0]
  return latest?.status === 'pending' && latest.message === 'Confirming...'
    ? 'Confirming...'
    : 'Waiting for MetaMask...'
}

function isAccountSelectionRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const details = error as { code?: string | number; message?: string; shortMessage?: string }
  const message = `${details.message ?? ''} ${details.shortMessage ?? ''}`.toLowerCase()
  return details.code === 4100 || /account.*(not selected|not authorized|unauthorized|not permitted)/.test(message)
}
