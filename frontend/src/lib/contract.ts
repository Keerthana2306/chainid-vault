import { Contract, ZeroHash, id, type ContractRunner } from 'ethers'
import deployment from '../contract/deployment.json'

interface DeploymentAccount {
  label: string
  address: string
}

interface Deployment {
  chainId: number
  address: string
  abi: ConstructorParameters<typeof Contract>[1]
  accounts: DeploymentAccount[]
}

const deploymentConfig = deployment as Deployment

export const contractAddress = deploymentConfig.address
export const contractAbi = deploymentConfig.abi
export const chainId = deploymentConfig.chainId
export const accounts = deploymentConfig.accounts

export const ADMIN = ZeroHash
export const MANAGER = id('MANAGER')
export const AUDITOR = id('AUDITOR')
export const USER = id('USER')

export type RoleName = 'Admin' | 'Manager' | 'Auditor' | 'User'

export const roleHashes = {
  Manager: MANAGER,
  Auditor: AUDITOR,
  User: USER,
} as const

export function roleName(hash: string): RoleName {
  switch (hash.toLowerCase()) {
    case ADMIN.toLowerCase():
      return 'Admin'
    case MANAGER.toLowerCase():
      return 'Manager'
    case AUDITOR.toLowerCase():
      return 'Auditor'
    case USER.toLowerCase():
      return 'User'
    default:
      throw new Error(`Unknown registry role: ${hash}`)
  }
}

interface ErrorDetails {
  code?: string | number
  data?: unknown
  shortMessage?: string
  message?: string
  error?: { data?: unknown }
  info?: { error?: { data?: unknown } }
}

function errorDetails(error: unknown): ErrorDetails {
  return typeof error === 'object' && error !== null ? error as ErrorDetails : {}
}

export function friendlyContractError(error: unknown, contract: Contract | null): string {
  const details = errorDetails(error)
  if (details.code === 'ACTION_REJECTED' || details.code === 4001) {
    return 'Transaction cancelled'
  }

  const data = details.data ?? details.info?.error?.data ?? details.error?.data
  if (contract && typeof data === 'string') {
    try {
      const parsed = contract.interface.parseError(data)
      if (parsed) {
        switch (parsed.name) {
          case 'AccessControlBadConfirmation':
            return 'Wallet confirmation did not match the connected account'
          case 'AccessControlUnauthorizedAccount': {
            const requiredRole = String(parsed.args[1])
            if (requiredRole.toLowerCase() === ADMIN.toLowerCase()) {
              return 'Only an Admin can do this'
            }
            if (requiredRole.toLowerCase() === MANAGER.toLowerCase()) {
              return 'Only an Admin or Manager can register an identity'
            }
            return 'Your account does not have the required role'
          }
          case 'AssetNotFound':
          case 'ERC721NonexistentToken':
            return 'That NFT does not exist'
          case 'AssetExpiryAlreadySet':
            return 'An expiry has already been set for that asset'
          case 'AssetExpiryNotFuture':
            return 'Choose an expiry date in the future'
          case 'AssetAlreadyRevoked':
            return 'That asset has already been permanently revoked'
          case 'AssetIsRevoked':
            return 'That asset is permanently revoked and cannot be transferred'
          case 'ERC721IncorrectOwner':
            return 'That NFT is not owned by this account'
          case 'ERC721InsufficientApproval':
            return 'The connected account is not authorized to transfer that NFT'
          case 'ERC721InvalidApprover':
            return 'That wallet cannot approve an NFT'
          case 'ERC721InvalidOperator':
            return 'That wallet cannot be an NFT operator'
          case 'ERC721InvalidOwner':
            return 'That wallet address cannot own an NFT'
          case 'ERC721InvalidReceiver':
            return 'That wallet cannot receive an NFT'
          case 'ERC721InvalidSender':
            return 'That wallet cannot send an NFT'
          case 'IdentityAlreadyRegistered':
            return 'That wallet is already registered'
          case 'IdentityInactive':
            return 'That identity was revoked'
          case 'IdentityNotActive':
            return 'That identity is already revoked'
          case 'IdentityNotRegistered':
            return 'That wallet is not a registered identity'
          case 'InvalidAddress':
            return 'Enter a non-zero wallet address'
          case 'InvalidDID':
            return 'The DID does not match the wallet address'
          case 'LastAdminCannotBeRemoved':
            return 'The last Admin cannot be removed'
          case 'StringsInsufficientHexLength':
            return 'The wallet address could not be converted to a DID'
          case 'UnsupportedRole':
            return 'That role is not supported by this registry'
          default:
            return 'The registry rejected this request'
        }
      }
    } catch {
      return details.shortMessage ?? 'The registry rejected this request'
    }
  }

  return details.shortMessage ?? 'Transaction failed. Please try again.'
}

export function didFor(address: string): string {
  return `did:ethr:${address.toLowerCase()}`
}

export function getContract(runner: ContractRunner): Contract {
  return new Contract(contractAddress, contractAbi, runner)
}

export function labelFor(address: string): string {
  const account = accounts.find(
    (entry) => entry.address.toLowerCase() === address.toLowerCase(),
  )
  return account?.label ?? `${address.slice(0, 6)}...${address.slice(-4)}`
}
