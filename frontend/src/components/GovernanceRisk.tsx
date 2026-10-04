import { useCallback, useEffect, useMemo, useState } from 'react'
import { ZeroAddress, type BrowserProvider, type Result } from 'ethers'
import { ADMIN, getContract } from '../lib/contract'
import { asAddress, displayAddress, eventDetails, queryAuditEvents } from '../lib/auditEvents'

interface GovernanceRiskProps {
  provider: BrowserProvider
  refreshSignal: number
}

interface GovernanceEvent {
  name: string
  actor: string | null
  subject: string | null
  details: string
  tokenId: string | null
  timestamp: number
  blockNumber: number
  logIndex: number
  transactionHash: string
  args: Result
}

interface GovernanceIdentity {
  address: string
  active: boolean
  roles: string[]
  tokens: string[]
}

interface GovernanceAsset {
  tokenId: string
  owner: string
  status: number
  expiry: number
}

interface GovernanceData {
  events: GovernanceEvent[]
  identities: GovernanceIdentity[]
  assets: GovernanceAsset[]
  refreshedAt: string
  asOf: number
}

const ROLE_CHANGE_EVENTS = new Set(['RoleAssigned', 'RoleGranted', 'RoleRevoked'])
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp * 1000))
}

function isAdmin(roles: string[]): boolean {
  return roles.some((role) => role.toLowerCase() === ADMIN.toLowerCase())
}

function isRoleChange(event: GovernanceEvent): boolean {
  return ROLE_CHANGE_EVENTS.has(event.name)
}

function roleChangeKey(event: GovernanceEvent): string {
  const action = event.name === 'RoleRevoked' ? 'revoked' : 'granted'
  const account = (event.subject ?? '').toLowerCase()
  const role = String(event.args.role ?? event.args[1] ?? event.args[0] ?? '').toLowerCase()
  return `${event.transactionHash}:${action}:${account}:${role}`
}

function assetHasActivitySinceMint(
  tokenId: string,
  events: GovernanceEvent[],
): boolean {
  return events.some((event) => {
    if (event.tokenId !== tokenId) return false
    if (event.name === 'AssetTransferred') return true
    return event.name === 'Transfer' && asAddress(event.args.from) !== ZeroAddress
  })
}

function downloadAudit(format: 'csv' | 'json', events: GovernanceEvent[]) {
  const rows = events.map((event) => ({
    time: new Date(event.timestamp * 1000).toISOString(),
    event: event.name,
    actor: event.actor ?? '',
    subject: event.subject ?? '',
    'tx hash': event.transactionHash,
    block: event.blockNumber,
  }))
  const content = format === 'json'
    ? JSON.stringify(rows, null, 2)
    : [
        ['time', 'event', 'actor', 'subject', 'tx hash', 'block'],
        ...rows.map((row) => [row.time, row.event, row.actor, row.subject, row['tx hash'], String(row.block)]),
      ].map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = `audit-trail.${format}`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

export function GovernanceRisk({ provider, refreshSignal }: GovernanceRiskProps) {
  const [data, setData] = useState<GovernanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadGovernanceData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const contract = getContract(provider)
      const queriedEvents = await queryAuditEvents(contract)
      const latestBlock = await provider.getBlock('latest')
      if (!latestBlock) throw new Error('Could not load the latest block timestamp')
      const blockNumbers = [...new Set(queriedEvents.map(({ log }) => log.blockNumber))]
      const blockTimestamps = new Map<number, number>()
      await Promise.all(blockNumbers.map(async (blockNumber) => {
        const block = await provider.getBlock(blockNumber)
        if (!block) throw new Error(`Could not load block ${blockNumber}`)
        blockTimestamps.set(blockNumber, block.timestamp)
      }))
      const events: GovernanceEvent[] = queriedEvents.map(({ name, log, args }) => {
        const details = eventDetails(name, args)
        return {
          name,
          actor: details.actor,
          subject: details.subjectAddress,
          details: details.details,
          tokenId: details.tokenId,
          timestamp: blockTimestamps.get(log.blockNumber) ?? 0,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          transactionHash: log.transactionHash,
          args,
        }
      }).sort((left, right) =>
        left.blockNumber - right.blockNumber || left.logIndex - right.logIndex,
      )

      const identityAddresses = [...new Map(events
        .filter((event) => event.name === 'IdentityRegistered' && event.subject)
        .map((event) => [event.subject!.toLowerCase(), event.subject!])).values()]
      const identityRecords = await Promise.all(identityAddresses.map(async (address) => {
        const [identity, roles, tokens] = await Promise.all([
          contract.getIdentity(address),
          contract.getRoles(address),
          contract.tokensOfOwner(address),
        ])
        return {
          address,
          active: Boolean(identity.active),
          roles: roles as string[],
          tokens: (tokens as bigint[]).map((tokenId) => tokenId.toString()),
        }
      }))
      const currentOwners = new Map<string, string>()
      for (const identity of identityRecords) {
        for (const tokenId of identity.tokens) currentOwners.set(tokenId, identity.address)
      }
      const mintedTokenIds = events
        .filter((event) => event.name === 'AssetMinted' && event.tokenId)
        .map((event) => event.tokenId as string)
      const tokenIds = [...new Set([...mintedTokenIds, ...currentOwners.keys()])]
      const assets = tokenIds.flatMap((tokenId) => {
        const owner = currentOwners.get(tokenId)
        return owner ? [{ tokenId, owner, status: 0, expiry: 0 }] : []
      })
      const assetsWithLifecycle = await Promise.all(assets.map(async (asset) => {
        const [status, expiry] = await Promise.all([
          contract.assetStatus(BigInt(asset.tokenId)),
          contract.expiryOf(BigInt(asset.tokenId)),
        ])
        return {
          ...asset,
          status: Number(status),
          expiry: Number(expiry),
        }
      }))

      setData({
        events,
        identities: identityRecords,
        assets: assetsWithLifecycle,
        refreshedAt: new Date().toLocaleTimeString(),
        asOf: latestBlock.timestamp,
      })
    } catch (loadError) {
      const details = typeof loadError === 'object' && loadError !== null
        ? loadError as { shortMessage?: string; message?: string }
        : {}
      setError(details.shortMessage ?? details.message ?? 'Could not load governance and risk data.')
    } finally {
      setLoading(false)
    }
  }, [provider])

  useEffect(() => {
    void Promise.resolve().then(loadGovernanceData)
  }, [loadGovernanceData, refreshSignal])

  const now = data?.asOf ?? 0
  const activeAdmins = useMemo(() => data?.identities.filter(
    (identity) => identity.active && isAdmin(identity.roles),
  ) ?? [], [data])
  const admins = useMemo(() => data?.identities.filter(
    (identity) => isAdmin(identity.roles),
  ) ?? [], [data])
  const revokedAssets = useMemo(() => {
    if (!data) return []
    const revokedAddresses = new Set(data.identities
      .filter((identity) => !identity.active)
      .map((identity) => identity.address.toLowerCase()))
    return data.assets.filter((asset) => revokedAddresses.has(asset.owner.toLowerCase()))
  }, [data])
  const recentRoleChanges = useMemo(() => {
    if (!data) return []
    const cutoff = now - SEVEN_DAYS_SECONDS
    const seen = new Set<string>()
    return data.events.filter((event) => {
      if (!isRoleChange(event) || event.timestamp < cutoff) return false
      const key = roleChangeKey(event)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).reverse()
  }, [data, now])
  const dormantAssets = useMemo(() => {
    if (!data) return []
    const mintedTokenIds = [...new Set(data.events
      .filter((event) => event.name === 'AssetMinted' && event.tokenId)
      .map((event) => event.tokenId as string))]
    return mintedTokenIds.filter((tokenId) => !assetHasActivitySinceMint(tokenId, data.events))
  }, [data])
  const expiringAssets = data?.assets.filter((asset) =>
    asset.status === 0 &&
    asset.expiry > now &&
    asset.expiry - now < 30 * 24 * 60 * 60,
  ) ?? []
  const expiredAssets = data?.assets.filter((asset) => asset.status === 1) ?? []
  const revokedCertificateAssets = data?.assets.filter((asset) => asset.status === 2) ?? []
  const eventCounts = useMemo(() => {
    if (!data) return []
    const counts = new Map<string, number>()
    for (const event of data.events) counts.set(event.name, (counts.get(event.name) ?? 0) + 1)
    return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
  }, [data])
  const maxEventCount = Math.max(1, ...eventCounts.map(([, count]) => count))
  const activeIdentities = data?.identities.filter((identity) => identity.active).length ?? 0
  const revokedIdentities = data ? data.identities.length - activeIdentities : 0
  const totalEvents = data?.events.length ?? 0

  return (
    <section className="governance-risk">
      <div className="governance-heading">
        <div>
          <p className="eyebrow">READ-ONLY · CONTRACT EVENTS &amp; REGISTRY STATE</p>
          <h2>Governance &amp; Risk</h2>
          <p>Registry health indicators derived from on-chain events and read-only contract views.</p>
        </div>
        <div className="governance-refresh">
          {data && <span className="count-label">Updated {data.refreshedAt}</span>}
          <button className="button button-small button-quiet" disabled={loading} onClick={() => void loadGovernanceData()}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="notice notice-error" role="alert">{error}</div>}

      <section className="governance-summary" aria-label="Registry summary">
        <article className="governance-summary-card"><span>Total identities</span><strong>{data ? data.identities.length : '—'}</strong></article>
        <article className="governance-summary-card"><span>Active / revoked</span><strong>{data ? `${activeIdentities} / ${revokedIdentities}` : '—'}</strong></article>
        <article className="governance-summary-card"><span>Total assets</span><strong>{data ? data.assets.length : '—'}</strong></article>
        <article className="governance-summary-card"><span>Total events</span><strong>{data ? totalEvents : '—'}</strong></article>
        <article className="governance-summary-card"><span>Admins</span><strong>{data ? admins.length : '—'}</strong></article>
      </section>

      <section className="governance-risk-section">
        <div className="governance-section-heading">
          <div><p className="eyebrow">REGISTRY HEALTH</p><h3>Risk checks</h3></div>
          {loading && <span className="count-label">Refreshing from chain…</span>}
        </div>
        <div className="governance-risk-grid">
          <article className={`governance-risk-card ${!data ? 'risk-loading' : activeAdmins.length === 1 ? 'risk-warning' : activeAdmins.length === 0 ? 'risk-danger' : 'risk-ok'}`}>
            <span className="risk-status">{!data ? (loading ? 'LOADING' : 'UNAVAILABLE') : activeAdmins.length === 1 ? 'WARNING' : activeAdmins.length === 0 ? 'ALERT' : 'OK'}</span>
            <h4>Active administrators</h4>
            {!data ? (
              <p>{loading ? 'Loading administrator data…' : 'Administrator data is unavailable.'}</p>
            ) : activeAdmins.length === 1 ? (
              <p>Single admin: key loss would lock governance.</p>
            ) : activeAdmins.length === 0 ? (
              <p>No active Admin can manage governance.</p>
            ) : (
              <p>{activeAdmins.length} active Admins can manage governance.</p>
            )}
            {activeAdmins.length > 0 && (
              <ul className="risk-detail-list">
                {activeAdmins.map((identity) => <li key={identity.address}>{displayAddress(identity.address)}</li>)}
              </ul>
            )}
          </article>

          <article className={`governance-risk-card ${!data ? 'risk-loading' : revokedAssets.length ? 'risk-danger' : 'risk-ok'}`}>
            <span className="risk-status">{!data ? (loading ? 'LOADING' : 'UNAVAILABLE') : revokedAssets.length ? 'WARNING' : 'OK'}</span>
            <h4>Assets held by revoked identities</h4>
            {!data ? (
              <p>{loading ? 'Loading identity and ownership data…' : 'Ownership data is unavailable.'}</p>
            ) : revokedAssets.length ? (
              <>
                <p>These assets are frozen.</p>
                <ul className="risk-detail-list">
                  {revokedAssets.map((asset) => <li key={asset.tokenId}>Token #{asset.tokenId} · {displayAddress(asset.owner)}</li>)}
                </ul>
              </>
            ) : <p>No assets are currently held by revoked identities.</p>}
          </article>

          <article className={`governance-risk-card ${!data ? 'risk-loading' : recentRoleChanges.length ? 'risk-warning' : 'risk-ok'}`}>
            <span className="risk-status">{!data ? (loading ? 'LOADING' : 'UNAVAILABLE') : recentRoleChanges.length ? 'WARNING' : 'OK'}</span>
            <h4>Role changes · last 7 days</h4>
            <p>{!data ? (loading ? 'Loading role events…' : 'Role event data is unavailable.') : recentRoleChanges.length ? `${recentRoleChanges.length} role change${recentRoleChanges.length === 1 ? '' : 's'} recorded in the last 7 days.` : 'No role changes recorded in the last 7 days.'}</p>
            {recentRoleChanges.length > 0 && (
              <ul className="risk-detail-list">
                {recentRoleChanges.map((event) => (
                  <li key={`${event.transactionHash}-${event.logIndex}`}>
                    {event.details}
                    <time>{formatTime(event.timestamp)}</time>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className={`governance-risk-card ${!data ? 'risk-loading' : dormantAssets.length ? 'risk-warning' : 'risk-ok'}`}>
            <span className="risk-status">{!data ? (loading ? 'LOADING' : 'UNAVAILABLE') : dormantAssets.length ? 'WARNING' : 'OK'}</span>
            <h4>Assets without post-mint activity</h4>
            <p>{!data ? (loading ? 'Loading asset history…' : 'Asset event data is unavailable.') : dormantAssets.length ? `${dormantAssets.length} asset${dormantAssets.length === 1 ? '' : 's'} have no custody activity since minting.` : 'Every asset has custody activity after minting.'}</p>
            {dormantAssets.length > 0 && (
              <ul className="risk-detail-list">
                {dormantAssets.map((tokenId) => <li key={tokenId}>Token #{tokenId}</li>)}
              </ul>
            )}
          </article>

          <article className={`governance-risk-card ${!data ? 'risk-loading' : expiringAssets.length ? 'risk-warning' : 'risk-ok'}`}>
            <span className="risk-status">{!data ? (loading ? 'LOADING' : 'UNAVAILABLE') : expiringAssets.length ? 'WARNING' : 'OK'}</span>
            <h4>Assets expiring within 30 days</h4>
            <p>{!data ? (loading ? 'Loading asset expiry data…' : 'Asset expiry data is unavailable.') : expiringAssets.length ? `${expiringAssets.length} asset${expiringAssets.length === 1 ? '' : 's'} expiring within 30 days.` : 'No assets expire within 30 days.'}</p>
            {expiringAssets.length > 0 && (
              <ul className="risk-detail-list">
                {expiringAssets.map((asset) => <li key={asset.tokenId}>Token #{asset.tokenId} · {formatTime(asset.expiry)}</li>)}
              </ul>
            )}
          </article>

          <article className={`governance-risk-card ${!data ? 'risk-loading' : expiredAssets.length ? 'risk-danger' : 'risk-ok'}`}>
            <span className="risk-status">{!data ? (loading ? 'LOADING' : 'UNAVAILABLE') : expiredAssets.length ? 'ALERT' : 'OK'}</span>
            <h4>Expired assets</h4>
            <p>{!data ? (loading ? 'Loading asset status…' : 'Asset status is unavailable.') : expiredAssets.length ? `${expiredAssets.length} expired asset${expiredAssets.length === 1 ? '' : 's'}.` : 'No expired assets.'}</p>
            {expiredAssets.length > 0 && (
              <ul className="risk-detail-list">
                {expiredAssets.map((asset) => <li key={asset.tokenId}>Token #{asset.tokenId}</li>)}
              </ul>
            )}
          </article>

          <article className={`governance-risk-card ${!data ? 'risk-loading' : revokedCertificateAssets.length ? 'risk-danger' : 'risk-ok'}`}>
            <span className="risk-status">{!data ? (loading ? 'LOADING' : 'UNAVAILABLE') : revokedCertificateAssets.length ? 'ALERT' : 'OK'}</span>
            <h4>Revoked assets</h4>
            <p>{!data ? (loading ? 'Loading asset status…' : 'Asset status is unavailable.') : revokedCertificateAssets.length ? `${revokedCertificateAssets.length} permanently revoked asset${revokedCertificateAssets.length === 1 ? '' : 's'}.` : 'No revoked assets.'}</p>
            {revokedCertificateAssets.length > 0 && (
              <ul className="risk-detail-list">
                {revokedCertificateAssets.map((asset) => <li key={asset.tokenId}>Token #{asset.tokenId}</li>)}
              </ul>
            )}
          </article>
        </div>
      </section>

      <section className="governance-chart-panel">
        <div className="governance-section-heading">
          <div><p className="eyebrow">ON-CHAIN ACTIVITY</p><h3>Events by type</h3></div>
          <div className="governance-export-actions">
            <button className="button button-small button-quiet" disabled={!data || loading} onClick={() => data && downloadAudit('csv', data.events)}>
              Download audit trail (CSV)
            </button>
            <button className="button button-small button-quiet" disabled={!data || loading} onClick={() => data && downloadAudit('json', data.events)}>
              Download audit trail (JSON)
            </button>
          </div>
        </div>
        {eventCounts.length ? (
          <div className="governance-chart" role="img" aria-label="Bar chart of contract event counts by event type">
            {eventCounts.map(([name, count]) => (
              <div className="governance-chart-column" key={name} title={`${name}: ${count}`}>
                <strong>{count}</strong>
                <div className="governance-chart-track">
                  <span style={{ height: `${Math.max(5, (count / maxEventCount) * 100)}%` }} />
                </div>
                <span className="governance-chart-label">{name}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="audit-empty">{loading ? 'Loading event counts…' : 'No contract events found.'}</div>
        )}
      </section>
    </section>
  )
}
