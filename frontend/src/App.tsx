import { useCallback, useEffect, useState } from 'react'
import type { BrowserProvider } from 'ethers'
import { verifyMessage } from 'ethers'
import { accounts, didFor, getContract, labelFor, roleName, type RoleName } from './lib/contract'
import { useWallet } from './hooks/useWallet'
import { AssetCard, DashboardCard, RoleBadge } from './components/DashboardCard'
import { RegistryActions } from './components/RegistryActions'
import { VerifyPage } from './components/VerifyPage'
import './App.css'

interface IdentityView {
  did: string
  registeredAt: string | null
  active: boolean
}

interface AssetView {
  tokenId: string
  name: string
  description: string
  createdAt: string | null
}

interface DashboardData {
  account: string
  provider: BrowserProvider
  chainId: bigint | null
  identity: IdentityView | null
  roles: RoleName[]
  assets: AssetView[]
}

interface RegistryError {
  account: string
  provider: BrowserProvider
  message: string
}

function formatTimestamp(value: bigint | number): string | null {
  const milliseconds = Number(value) * 1000
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 8.64e15) {
    return null
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(milliseconds))
}

const demoRoles: Record<string, RoleName> = {
  Admin: 'Admin',
  Manager: 'Manager',
  Auditor: 'Auditor',
  Alice: 'User',
  Bob: 'User',
}

function WalletApp() {
  const wallet = useWallet()
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [readError, setReadError] = useState<RegistryError | null>(null)
  const [didSession, setDidSession] = useState<{
    account: string
    chainId: bigint
    walletRevision: number
    did: string
  } | null>(null)
  const [signing, setSigning] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const verified = Boolean(
    didSession &&
    wallet.account &&
    wallet.chainId !== null &&
    didSession.account.toLowerCase() === wallet.account.toLowerCase() &&
    didSession.chainId === wallet.chainId &&
    didSession.walletRevision === wallet.walletRevision,
  )
  const verifiedDid = verified ? didSession?.did : null
  const dashboardIsCurrent = Boolean(
    dashboard &&
    dashboard.account === wallet.account &&
    dashboard.provider === wallet.provider &&
    dashboard.chainId === wallet.chainId &&
    wallet.contractDeployed === true,
  )
  const identity = dashboardIsCurrent ? dashboard?.identity ?? null : null
  const roles = dashboardIsCurrent ? dashboard?.roles ?? [] : []
  const assets = dashboardIsCurrent ? dashboard?.assets ?? [] : []
  const currentReadError =
    readError?.account === wallet.account && readError.provider === wallet.provider
      ? readError.message
      : null

  const fetchDashboard = useCallback(async (): Promise<DashboardData | null> => {
    if (!wallet.provider || !wallet.account || !wallet.contractDeployed) {
      return null
    }

    const contract = getContract(wallet.provider)
    const [identityRecord, roleHashes, tokenIds] = await Promise.all([
      contract.getIdentity(wallet.account),
      contract.getRoles(wallet.account),
      contract.tokensOfOwner(wallet.account),
    ])

    const nextIdentity: IdentityView | null = identityRecord.did
      ? {
          did: identityRecord.did,
          registeredAt: formatTimestamp(identityRecord.registeredAt),
          active: identityRecord.active,
        }
      : null
    const nextRoles = (roleHashes as string[]).map((hash) => roleName(hash))
    const nextAssets = await Promise.all(
      (tokenIds as bigint[]).map(async (tokenId) => {
        const record = await contract.getAsset(tokenId)
        return {
          tokenId: BigInt(tokenId).toString(),
          name: record.name,
          description: record.description,
          createdAt: formatTimestamp(record.createdAt),
        }
      }),
    )

    return {
      account: wallet.account,
      provider: wallet.provider,
      chainId: wallet.chainId,
      identity: nextIdentity,
      roles: nextRoles,
      assets: nextAssets,
    }
  }, [wallet.account, wallet.chainId, wallet.contractDeployed, wallet.provider])

  useEffect(() => {
    let active = true
    void fetchDashboard().then((data) => {
      if (active && data) {
        setDashboard(data)
        setReadError(null)
      }
    }).catch(() => {
      if (active && wallet.account && wallet.provider) {
        setReadError({
          account: wallet.account,
          provider: wallet.provider,
          message: 'Could not read registry data. Check the selected network and deployment.',
        })
      }
    })
    return () => {
      active = false
    }
  }, [fetchDashboard, wallet.account, wallet.provider])

  const refreshDashboard = async () => {
    setLoading(true)
    try {
      const data = await fetchDashboard()
      if (data) {
        setDashboard(data)
        setReadError(null)
      }
    } catch {
      if (wallet.account && wallet.provider) {
        setReadError({
          account: wallet.account,
          provider: wallet.provider,
          message: 'Could not read registry data. Check the selected network and deployment.',
        })
      }
    } finally {
      setLoading(false)
    }
  }

  const signInWithDid = async () => {
    if (!wallet.account || !wallet.signer || wallet.chainId === null) return
    setSigning(true)
    setSignInError(null)
    try {
      const nonceBytes = new Uint8Array(16)
      window.crypto.getRandomValues(nonceBytes)
      const nonce = Array.from(nonceBytes, (value) => value.toString(16).padStart(2, '0')).join('')
      const did = didFor(wallet.account)
      const message = [
        'Identity & Asset Registry DID Sign-In',
        `Address: ${wallet.account}`,
        `DID: ${did}`,
        `Nonce: 0x${nonce}`,
        `Timestamp: ${new Date().toISOString()}`,
      ].join('\n')
      const signature = await wallet.signer.signMessage(message)
      const recoveredAddress = verifyMessage(message, signature)
      if (recoveredAddress.toLowerCase() !== wallet.account.toLowerCase()) {
        setSignInError('Signature verification failed. Sign in again with the connected account.')
        setDidSession(null)
        return
      }
      setDidSession({
        account: wallet.account,
        chainId: wallet.chainId,
        walletRevision: wallet.walletRevision,
        did,
      })
    } catch (error) {
      const details = typeof error === 'object' && error !== null
        ? error as { code?: string | number; shortMessage?: string }
        : {}
      if (
        details.code === 4100 ||
        (error instanceof Error && /account.*(not selected|not authorized|unauthorized|not permitted)/i.test(error.message))
      ) {
        await wallet.requestAccountFallback(labelFor(wallet.account))
      }
      setSignInError(
        details.code === 'ACTION_REJECTED' || details.code === 4001
          ? 'Sign-in cancelled'
          : details.shortMessage ?? 'Could not verify the DID signature.',
      )
      setDidSession(null)
    } finally {
      setSigning(false)
    }
  }

  const allWalletRoles = ['Admin', 'Manager', 'Auditor', 'User'] as const
  const registeredStatus = identity
    ? identity.active ? 'Active' : 'Revoked'
    : dashboardIsCurrent ? 'Not registered' : currentReadError ? 'Unavailable' : 'Loading'

  return (
    <main className="app-shell">
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
        <div className="header-actions">
          <a className="topbar-verify-link" href="#/verify">Verify</a>
          {wallet.account ? (
            <div className="account-summary">
              <span className="account-avatar" aria-hidden="true">
                {labelFor(wallet.account).slice(0, 1)}
              </span>
              <span className="account-copy">
                <strong>{labelFor(wallet.account)}</strong>
                <span>{`${wallet.account.slice(0, 6)}...${wallet.account.slice(-4)}`}</span>
              </span>
            </div>
          ) : (
            <span className="wallet-disconnected">Wallet not connected</span>
          )}
          {wallet.account ? (
            <div className="header-roles" aria-label="Account roles">
              {roles.map((role) => (
                <RoleBadge key={role} role={role} showDescription />
              ))}
            </div>
          ) : (
            <button className="button button-primary" onClick={() => void wallet.connect()}>
              Connect wallet
            </button>
          )}
          {wallet.account && (
            <div className="did-signin">
              <button
                className={`button ${verified ? 'button-verified' : 'button-primary'}`}
                disabled={signing || !wallet.signer}
                onClick={() => void signInWithDid()}
              >
                {signing ? 'Waiting for MetaMask…' : verified ? 'Verified ✓' : 'Sign in with DID'}
              </button>
              {verifiedDid && <code className="verified-did">{verifiedDid}</code>}
            </div>
          )}
        </div>
      </header>

      {wallet.account && (
        <section className="acting-bar" aria-label="Choose active demo account">
          <div className="acting-title">
            <strong>Acting as</strong>
            <span>Choose a permitted demo account</span>
          </div>
          <div className="acting-account-list">
            {accounts.map((demoAccount) => {
              const permitted = wallet.permittedAccounts.some(
                (address) => address.toLowerCase() === demoAccount.address.toLowerCase(),
              )
              const active = wallet.account?.toLowerCase() === demoAccount.address.toLowerCase()
              return (
                <button
                  aria-pressed={active}
                  className={`acting-account ${active ? 'is-active' : ''}`}
                  disabled={!permitted}
                  key={demoAccount.address}
                  onClick={() => void wallet.selectAccount(demoAccount.address)}
                  title={permitted ? `${demoAccount.label} · ${demoAccount.address}` : 'Not connected in MetaMask'}
                >
                  <span className="acting-account-copy">
                    <strong>{demoAccount.label}</strong>
                    <span>{`${demoAccount.address.slice(0, 6)}...${demoAccount.address.slice(-4)}`}</span>
                  </span>
                  <RoleBadge role={demoRoles[demoAccount.label]} />
                </button>
              )
            })}
          </div>
          <button
            className="button button-small button-quiet connect-more-button"
            onClick={() => void (wallet.accountSelectionMessage
              ? wallet.refreshSelectedAccount()
              : wallet.connectMoreAccounts())}
          >
            {wallet.accountSelectionMessage ? 'Refresh' : 'Connect more accounts'}
          </button>
        </section>
      )}
      {wallet.accountSelectionMessage && (
        <div className="notice notice-warning account-selection-notice" role="status">
          {wallet.accountSelectionMessage}
        </div>
      )}

      <section className="page-heading">
        <div>
          <p className="eyebrow">LOCAL BLOCKCHAIN · HARDHAT</p>
          <h1>Your registry overview</h1>
          <p className="heading-subtitle">
            Verify your decentralized identity, access roles, and registered assets.
          </p>
        </div>
        <div className="network-indicator">
          <span className={`network-dot ${wallet.chainId === 31337n ? 'is-online' : ''}`} />
          <span>{wallet.chainId === 31337n ? 'Hardhat Local' : 'Local network'}</span>
        </div>
      </section>

      {wallet.error && (
        <div className="notice notice-error" role="alert">
          <span>{wallet.error}</span>
          {wallet.error.includes('MetaMask') && (
            <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
              Install MetaMask
            </a>
          )}
          {signInError && (
            <div className="notice notice-error" role="alert">{signInError}</div>
          )}
        </div>
      )}
      {wallet.account && wallet.chainId !== null && wallet.chainId !== 31337n && (
        <div className="notice notice-warning" role="status">
          <span>Connect to the Hardhat Local network to view registry data.</span>
          <button className="button button-small" onClick={() => void wallet.switchNetwork()}>
            Switch network
          </button>
        </div>
      )}
      {wallet.contractDeployed === false && (
        <div className="notice notice-warning" role="alert">
          <span>
            Contract not found at the saved address. Run npm run node and npm run deploy:local,
            then refresh.
          </span>
        </div>
      )}
      {currentReadError && (
        <div className="notice notice-error" role="alert">
          Registry data could not be loaded: {currentReadError}
        </div>
      )}

      {!wallet.account ? (
        <section className="welcome-card">
          <div className="welcome-icon" aria-hidden="true">⌁</div>
          <div>
            <h2>Connect your wallet</h2>
            <p>Connect one of the five local demo accounts to view its identity and assets.</p>
          </div>
          <button className="button button-primary" onClick={() => void wallet.connect()}>
            Connect wallet
          </button>
        </section>
      ) : (
        <>
          <div className="summary-grid">
            <DashboardCard
              title="Identity"
              eyebrow="DECENTRALIZED ID"
              icon="◎"
              trailing={
                <span
                  className={`status-pill ${
                    identity ? (identity.active ? 'status-active' : 'status-revoked') : 'status-muted'
                  }`}
                >
                  <span className="status-dot" />
                  {registeredStatus}
                </span>
              }
            >
              {!dashboardIsCurrent ? (
                <div className="empty-identity">
                  {currentReadError ? 'Identity data unavailable' : 'Loading identity…'}
                </div>
              ) : identity ? (
                <div className="identity-details">
                  <div>
                    <span className="field-label">DID</span>
                    <code className="did-value">{identity.did}</code>
                  </div>
                  <div>
                    <span className="field-label">Registered</span>
                    <strong>{identity.registeredAt ?? 'Date unavailable'}</strong>
                  </div>
                </div>
              ) : (
                <div className="empty-identity">
                  <strong>Not registered</strong>
                  <span>Your identity DID will be</span>
                  <code>{didFor(wallet.account)}</code>
                </div>
              )}
            </DashboardCard>

            <DashboardCard
              title="Access roles"
              eyebrow="PERMISSIONS"
              icon="◇"
              trailing={<span className="count-label">{roles.length} assigned</span>}
            >
              {!dashboardIsCurrent ? (
                <div className="empty-state compact-empty">
                  {currentReadError ? 'Role data unavailable' : 'Loading roles…'}
                </div>
              ) : roles.length ? (
                <div className="role-list">
                  {allWalletRoles.map((role) => (
                    <div className="role-row" key={role}>
                      <span className="role-name">{role}</span>
                      {roles.includes(role) ? (
                        <RoleBadge role={role} showDescription />
                      ) : (
                        <span className="role-not-assigned">Not assigned</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state compact-empty">
                  <span className="empty-symbol">◇</span>
                  <span>No roles assigned</span>
                </div>
              )}
            </DashboardCard>
          </div>

          <section className="assets-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">ON-CHAIN OWNERSHIP</p>
                <h2>Your assets</h2>
              </div>
              <div className="asset-heading-actions">
                <span className="count-label">{assets.length} {assets.length === 1 ? 'asset' : 'assets'}</span>
                <button
                  className="button button-small button-quiet"
                  onClick={() => void refreshDashboard()}
                  disabled={loading}
                >
                  {loading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            </div>
            {currentReadError ? (
              <div className="assets-empty">Asset data unavailable.</div>
            ) : (!dashboardIsCurrent && wallet.contractDeployed === true) ||
            (loading && assets.length === 0) ? (
              <div className="assets-empty">Loading registry data…</div>
            ) : !dashboardIsCurrent ? (
              <div className="assets-empty">
                <span className="empty-symbol">▱</span>
                <strong>Registry data unavailable</strong>
                <span>Connect to the deployed Hardhat Local registry to view assets.</span>
              </div>
            ) : assets.length ? (
              <div className="asset-grid">
                {assets.map((asset) => (
                  <AssetCard key={asset.tokenId} asset={asset} />
                ))}
              </div>
            ) : (
              <div className="assets-empty">
                <span className="empty-symbol">▱</span>
                <strong>No assets yet</strong>
                <span>Assets assigned to this account will appear here.</span>
              </div>
            )}
          </section>
        </>
      )}

      {wallet.account && wallet.provider && (
        <RegistryActions
          account={wallet.account}
          assets={assets}
          onSuccess={refreshDashboard}
          provider={wallet.provider}
          signer={wallet.signer}
          verified={verified}
          refreshSignal={wallet.walletRevision}
          requestAccountFallback={wallet.requestAccountFallback}
        />
      )}

      <footer className="page-footer">
        <span>Identity &amp; Asset Registry</span>
        <span>Connected to a local Hardhat blockchain</span>
      </footer>
    </main>
  )
}

function verificationTokenFromHash(hash: string): string {
  if (!hash.startsWith('#/verify')) return ''
  const tokenPath = hash.slice('#/verify'.length).replace(/^\/+/, '').split(/[/?]/, 1)[0] ?? ''
  try {
    return decodeURIComponent(tokenPath)
  } catch {
    return tokenPath
  }
}

function App() {
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const updateHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', updateHash)
    return () => window.removeEventListener('hashchange', updateHash)
  }, [])

  if (hash.startsWith('#/verify')) {
    const initialTokenId = verificationTokenFromHash(hash)
    return <VerifyPage key={initialTokenId} initialTokenId={initialTokenId} />
  }
  return <WalletApp />
}

export default App
