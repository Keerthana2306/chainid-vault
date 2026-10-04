import { Contract, ZeroAddress, type EventFragment, type EventLog, type Result } from 'ethers'
import { labelFor, roleName } from './contract'

export interface QueriedAuditEvent {
  name: string
  log: EventLog
  args: Result
}

export interface AuditEventDetails {
  actor: string | null
  subjectAddress: string | null
  tokenId: string | null
  details: string
}

export function asAddress(value: unknown): string | null {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value) ? value : null
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function displayAddress(address: string | null): string {
  if (!address) return '—'
  const label = labelFor(address)
  return label === shortAddress(address) ? label : `${label} · ${shortAddress(address)}`
}

export function roleLabel(value: unknown): string {
  if (typeof value !== 'string') return 'Unknown role'
  try {
    return roleName(value)
  } catch {
    return 'Unknown role'
  }
}

export function eventDetails(name: string, args: Result): AuditEventDetails {
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
    case 'RoleRevoked': {
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
    case 'AssetExpirySet':
      return {
        actor,
        subjectAddress: null,
        tokenId: token,
        details: `Set token #${token} expiry to ${new Date(Number(args.expiry) * 1000).toLocaleDateString()}`,
      }
    case 'AssetRevoked':
      return {
        actor,
        subjectAddress: null,
        tokenId: token,
        details: `Revoked token #${token}: ${String(args.reason)}`,
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

export async function queryAuditEvents(contract: Contract): Promise<QueriedAuditEvent[]> {
  const eventFragments = contract.interface.fragments.filter(
    (fragment): fragment is EventFragment => fragment.type === 'event',
  )
  const groupedLogs = await Promise.all(
    eventFragments.map(async (fragment) => ({
      name: fragment.name,
      logs: await contract.queryFilter(fragment.format('sighash'), 0),
    })),
  )
  return groupedLogs.flatMap(({ name, logs }) =>
    logs.flatMap((log) => 'args' in log
      ? [{
          name,
          log: log as EventLog,
          args: log.args,
        }]
      : []),
  )
}
