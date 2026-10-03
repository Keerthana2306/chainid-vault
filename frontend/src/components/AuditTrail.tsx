import { useCallback, useEffect, useMemo, useState } from 'react'
import { ZeroAddress, type BrowserProvider, type EventFragment, type EventLog, type Result } from 'ethers'
import { getContract, labelFor, roleName, type RoleName } from '../lib/contract'
import { RoleBadge } from './DashboardCard'

interface AuditTrailProps {
  provider: BrowserProvider
  refreshSignal: number
}

interface AuditEntry {
  name: string
  blockNumber: number
  logIndex: number
  transactionHash: string
  args: Result
  actor: string | null
  subjectAddress: string | null
  tokenId: string | null
  details: string
  timestamp: number
}

interface IdentityEntry {
  address: string
  did: string
  active: boolean
  roles: RoleName[]
}

function asAddress(value: unknown): string | null {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value) ? value : null
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function displayAddress(address: string | null): string {
  if (!address) return '—'
  const label = labelFor(address)
  return label === shortAddress(address) ? label : `${label} · ${shortAddress(address)}`
}

function roleLabel(value: unknown): string {
  if (typeof value !== 'string') return 'Unknown role'
  try {
    return roleName(value)
  } catch {
    return 'Unknown role'
  }
}

function eventDetails(name: string, args: Result): {
  actor: string | null
  subjectAddress: string | null
  tokenId: string | null
  details: string
} {
  const address = (...keys: string[]) => {
    for (const key of keys) {
      const candidate = asAddress(args[key])
      if (candidate) return candidate
    }
    return null
  }
  const actor = address('actor', 'sender')
  const token = args.tokenId === undefined ? null : String(args.tokenId)

  switch (name) {
    case 'IdentityRegistered':
      return {
        actor,
        subjectAddress: address('account'),
        tokenId: null,
        details: `Registered ${String(args.did)}`,
      }
    case 'IdentityRevoked':
      return {
        actor,
        subjectAddress: address('account'),
        tokenId: null,
        details: `Revoked identity for ${displayAddress(address('account'))}`,
      }
    case 'RoleAssigned':
    case 'RoleGranted':
      return {
        actor,
        subjectAddress: address('account'),
        tokenId: null,
        details: `Granted ${roleLabel(args.role)} to ${displayAddress(address('account'))}`,
      }
    case 'RoleRevoked':
      {
        const role = args.role ?? args[0]
        const target = address('account') ?? asAddress(args[1])
        return {
          actor,
          subjectAddress: target,
          tokenId: null,
          details: `Revoked ${roleLabel(role)} from ${displayAddress(target)}`,
        }
      }
    case 'AssetMinted':
      return {
        actor,
        subjectAddress: address('to'),
        tokenId: token,
        details: `Minted token #${token} to ${displayAddress(address('to'))}`,
      }
    case 'AssetTransferred':
      return {
        actor,
        subjectAddress: address('to'),
        tokenId: token,
        details: `Transferred token #${token} from ${displayAddress(address('from'))} to ${displayAddress(address('to'))}`,
      }
    case 'Transfer': {
      const from = address('from')
      const to = address('to')
      const movement = from === ZeroAddress
        ? `Minted token #${token} to ${displayAddress(to)}`
        : to === ZeroAddress
          ? `Burned token #${token} from ${displayAddress(from)}`
          : `Transferred token #${token} from ${displayAddress(from)} to ${displayAddress(to)}`
      return { actor: null, subjectAddress: to ?? from, tokenId: token, details: movement }
    }
    case 'AssetApprovalUpdated':
    case 'Approval':
      return {
        actor,
        subjectAddress: address('owner'),
        tokenId: token,
        details: `Updated approval for token #${token} by ${displayAddress(address('owner'))}`,
      }
    case 'OperatorApprovalUpdated':
    case 'ApprovalForAll':
      return {
        actor,
        subjectAddress: address('owner'),
        tokenId: null,
        details: `${args.approved ? 'Approved' : 'Removed'} operator ${displayAddress(address('operator'))} for ${displayAddress(address('owner'))}`,
      }
    case 'RoleAdminChanged':
      return {
        actor: null,
        subjectAddress: null,
        tokenId: null,
        details: `Admin role updated for ${roleLabel(args.role)}`,
      }
    default:
      return {
        actor,
        subjectAddress: address('account', 'owner', 'to'),
        tokenId: token,
        details: `${name} event`,
      }
  }
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(timestamp * 1000))
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`
}

export function AuditTrail({ provider, refreshSignal }: AuditTrailProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [identities, setIdentities] = useState<IdentityEntry[]>([])
  const [currentOwners, setCurrentOwners] = useState<Record<string, string>>({})
  const [eventFilter, setEventFilter] = useState('All events')
  const [addressFilter, setAddressFilter] = useState('')
  const [tokenFilter, setTokenFilter] = useState('')
  const [timelineTokenId, setTimelineTokenId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<string | null>(null)

  const loadEvents = useCallback(async () => {
    try {
      const contract = getContract(provider)
      const eventFragments = contract.interface.fragments.filter(
        (fragment): fragment is EventFragment => fragment.type === 'event',
      )
      const groupedLogs = await Promise.all(
        eventFragments.map(async (fragment) => ({
          name: fragment.name,
          logs: await contract.queryFilter(fragment.format('sighash'), 0),
        })),
      )
      const allLogs = groupedLogs.flatMap(({ name, logs }) =>
        logs.flatMap((log) => 'args' in log
          ? [{
              name,
              log: log as EventLog,
              args: log.args,
            }]
          : []),
      )
      const blockNumbers = [...new Set(allLogs.map(({ log }) => log.blockNumber))]
      const blockTimestamps = new Map<number, number>()
      await Promise.all(blockNumbers.map(async (blockNumber) => {
        const block = await provider.getBlock(blockNumber)
        if (!block) throw new Error(`Could not load block ${blockNumber}`)
        blockTimestamps.set(blockNumber, block.timestamp)
      }))

      const nextEntries = allLogs.map(({ name, log, args }) => ({
        name,
        blockNumber: log.blockNumber,
        logIndex: log.index,
        transactionHash: log.transactionHash,
        args,
        ...eventDetails(name, args),
        timestamp: blockTimestamps.get(log.blockNumber) ?? 0,
      })).sort((left, right) =>
        left.blockNumber - right.blockNumber || left.logIndex - right.logIndex,
      )
      const registeredAddresses = [...new Set(nextEntries
        .filter((entry) => entry.name === 'IdentityRegistered')
        .map((entry) => entry.subjectAddress)
        .filter((address): address is string => address !== null))]
      const nextIdentities = await Promise.all(registeredAddresses.map(async (address) => {
        const [identity, roleHashes] = await Promise.all([
          contract.getIdentity(address),
          contract.getRoles(address),
        ])
        const roles = (roleHashes as string[]).flatMap((hash) => {
          try {
            return [roleName(hash)]
          } catch {
            return []
          }
        })
        return {
          address,
          did: identity.did,
          active: identity.active,
          roles,
        }
      }))

      const mintedTokenIds = [...new Set(nextEntries
        .filter((entry) => entry.name === 'AssetMinted' && entry.tokenId)
        .map((entry) => entry.tokenId as string))]
      const ownerEntries = await Promise.all(mintedTokenIds.map(async (tokenId) => {
        try {
          return [tokenId, await contract.ownerOf(tokenId)] as const
        } catch {
          return [tokenId, ''] as const
        }
      }))
      setEntries(nextEntries)
      setIdentities(nextIdentities)
      setCurrentOwners(Object.fromEntries(ownerEntries))
      setTimelineTokenId((selected) =>
        selected && mintedTokenIds.includes(selected) ? selected : mintedTokenIds[0] ?? '',
      )
      setLoadedAt(new Date().toLocaleTimeString())
      setError(null)
    } catch (loadError) {
      const details = typeof loadError === 'object' && loadError !== null
        ? loadError as { shortMessage?: string; message?: string }
        : {}
      setError(details.shortMessage ?? details.message ?? 'Could not load contract events.')
    }
  }, [provider])

  useEffect(() => {
    void Promise.resolve().then(loadEvents)
  }, [loadEvents, refreshSignal])

  const refreshEvents = async () => {
    setLoading(true)
    try {
      await loadEvents()
    } finally {
      setLoading(false)
    }
  }

  const visibleEntries = useMemo(() => {
    const normalizedAddress = addressFilter.trim().toLowerCase()
    const matching = entries.filter((entry) => {
      if (eventFilter !== 'All events' && entry.name !== eventFilter) return false
      if (normalizedAddress) {
        const relatedAddresses = [
          entry.actor,
          entry.subjectAddress,
          asAddress(entry.args.from),
          asAddress(entry.args.to),
          asAddress(entry.args.account),
          asAddress(entry.args.owner),
          asAddress(entry.args.operator),
        ].filter((address): address is string => address !== null)
        if (!relatedAddresses.some((address) => address.toLowerCase().includes(normalizedAddress))) {
          return false
        }
      }
      if (tokenFilter && entry.tokenId !== tokenFilter.trim()) return false
      return true
    })
    return [...matching].reverse()
  }, [addressFilter, entries, eventFilter, tokenFilter])

  const timelineEntries = useMemo(() => entries.filter((entry) =>
    entry.tokenId === timelineTokenId &&
    ['AssetMinted', 'AssetTransferred'].includes(entry.name),
  ).reverse(), [entries, timelineTokenId])

  const eventNames = [...new Set(entries.map((entry) => entry.name))].sort()

  return (
    <section className="audit-trail">
      <div className="audit-heading">
        <div>
          <p className="eyebrow">READ-ONLY · ON-CHAIN HISTORY</p>
          <h2>Audit Trail</h2>
          <p>Events are read from block 0 and ordered by block and log position.</p>
        </div>
        <div className="audit-refresh">
          {loadedAt && <span className="count-label">Updated {loadedAt}</span>}
          <button className="button button-small button-quiet" disabled={loading} onClick={() => void refreshEvents()}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="notice notice-error" role="alert">{error}</div>}

      <section className="identity-directory">
        <div className="audit-subheading">
          <div>
            <p className="eyebrow">REGISTRY DIRECTORY</p>
            <h3>Identities</h3>
          </div>
          <span className="count-label">{identities.length} identities</span>
        </div>
        {identities.length ? (
          <div className="identity-table-wrap">
            <table className="audit-table identity-table">
              <thead>
                <tr><th>Account</th><th>DID</th><th>Roles</th><th>Status</th></tr>
              </thead>
              <tbody>
                {identities.map((identity) => (
                  <tr key={identity.address}>
                    <td>{displayAddress(identity.address)}</td>
                    <td><code>{identity.did}</code></td>
                    <td>
                      <span className="audit-role-list">
                        {identity.roles.map((role) => <RoleBadge key={role} role={role} />)}
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill ${identity.active ? 'status-active' : 'status-revoked'}`}>
                        <span className="status-dot" />
                        {identity.active ? 'Active' : 'Revoked'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="audit-empty">{!loadedAt || loading ? 'Loading identities…' : 'No registered identities found.'}</div>
        )}
      </section>

      <section className="timeline-panel">
        <div className="audit-subheading">
          <div>
            <p className="eyebrow">TOKEN HISTORY</p>
            <h3>Asset timeline</h3>
          </div>
          <label className="timeline-select">
            <span>Token ID</span>
            <select onChange={(event) => setTimelineTokenId(event.target.value)} value={timelineTokenId}>
              {!entries.some((entry) => entry.name === 'AssetMinted') && <option value="">No minted assets</option>}
              {[...new Set(entries
                .filter((entry) => entry.name === 'AssetMinted')
                .map((entry) => entry.tokenId)
                .filter((tokenId): tokenId is string => tokenId !== null))].map((tokenId) => (
                  <option key={tokenId} value={tokenId}>#{tokenId}</option>
                ))}
            </select>
          </label>
        </div>
        {timelineTokenId && (
          <>
            <div className="current-owner">
              <span>Current owner</span>
              <strong>{displayAddress(currentOwners[timelineTokenId] || null)}</strong>
            </div>
            {timelineEntries.length ? (
              <ol className="asset-timeline">
                {timelineEntries.map((entry) => {
                  const from = asAddress(entry.args.from)
                  const to = asAddress(entry.args.to)
                  const receiver = entry.name === 'AssetMinted'
                    ? asAddress(entry.args.to)
                    : to
                  const sender = entry.name === 'AssetMinted'
                    ? null
                    : from
                  return (
                    <li className="timeline-item" key={`${entry.transactionHash}-${entry.logIndex}`}>
                      <span className="timeline-marker" />
                      <div>
                        <strong>
                          {entry.name === 'AssetMinted'
                            ? `Minted by ${displayAddress(entry.actor)} to ${displayAddress(receiver)}`
                            : `Transferred from ${displayAddress(sender)} to ${displayAddress(receiver)}`}
                        </strong>
                        <time>{formatTime(entry.timestamp)}</time>
                      </div>
                    </li>
                  )
                })}
              </ol>
            ) : <div className="audit-empty">No timeline events for this token.</div>}
          </>
        )}
      </section>

      <section className="event-history">
        <div className="audit-subheading">
          <div>
            <p className="eyebrow">CONTRACT EVENTS</p>
            <h3>All activity</h3>
          </div>
          <span className="count-label">{visibleEntries.length} events</span>
        </div>
        <div className="audit-filters">
          <label className="form-field">
            <span>Event type</span>
            <select onChange={(event) => setEventFilter(event.target.value)} value={eventFilter}>
              <option>All events</option>
              {eventNames.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label className="form-field">
            <span>Address</span>
            <input
              onChange={(event) => setAddressFilter(event.target.value)}
              placeholder="Filter by address"
              value={addressFilter}
            />
          </label>
          <label className="form-field">
            <span>Token ID</span>
            <input
              inputMode="numeric"
              onChange={(event) => setTokenFilter(event.target.value)}
              placeholder="Filter by token ID"
              value={tokenFilter}
            />
          </label>
        </div>
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr><th>Time</th><th>Event</th><th>Actor</th><th>Subject</th><th>Details</th><th>Transaction</th></tr>
            </thead>
            <tbody>
              {visibleEntries.map((entry) => (
                <tr key={`${entry.transactionHash}-${entry.logIndex}`}>
                  <td>{formatTime(entry.timestamp)}</td>
                  <td><span className="event-name">{entry.name}</span></td>
                  <td>{displayAddress(entry.actor)}</td>
                  <td>{entry.tokenId
                    ? `Token #${entry.tokenId}`
                    : ['RoleAssigned', 'RoleGranted', 'RoleRevoked'].includes(entry.name)
                      ? `${roleLabel(entry.args.role ?? entry.args[0])} · ${displayAddress(entry.subjectAddress ?? asAddress(entry.args[1]))}`
                      : displayAddress(entry.subjectAddress)}</td>
                  <td>{entry.details}</td>
                  <td><code title={entry.transactionHash}>{shortHash(entry.transactionHash)}</code></td>
                </tr>
              ))}
              {!visibleEntries.length && (
                <tr><td className="audit-empty-cell" colSpan={6}>{!loadedAt || loading ? 'Loading events…' : 'No matching events.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}
