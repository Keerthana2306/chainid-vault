import deploymentConfig from '../contract/deployment.json'
import type { Contract } from 'ethers'

interface DeploymentConfig {
  chainId: number
  address: string
  abi: ConstructorParameters<typeof Contract>[1]
  deployBlockNumber?: number
  deployBlock?: number
  accounts?: { label: string; address: string }[]
}

const deploymentData = deploymentConfig as DeploymentConfig
const selectedNetwork = import.meta.env.VITE_NETWORK

if (selectedNetwork && selectedNetwork !== 'local' && selectedNetwork !== 'sepolia') {
  throw new Error('VITE_NETWORK must be either "local" or "sepolia".')
}

export const isLocal = selectedNetwork !== 'sepolia'
export const chainId = isLocal ? 31337 : 11155111
export const chainName = isLocal ? 'Hardhat Local' : 'Sepolia'
if (deploymentData.chainId !== chainId) {
  throw new Error(
    `The selected ${chainName} network does not match the deployment JSON chain ID ${deploymentData.chainId}. Run npm run sync-deployment.`,
  )
}
export const rpcUrl =
  import.meta.env.VITE_RPC_URL ||
  (isLocal ? 'http://127.0.0.1:8545' : 'https://ethereum-sepolia-rpc.publicnode.com')
export const explorerUrl = isLocal ? null : 'https://sepolia.etherscan.io'
export const deployment = {
  address: deploymentData.address,
  abi: deploymentData.abi,
  deployBlock: deploymentData.deployBlockNumber ?? deploymentData.deployBlock ?? 0,
  accounts: deploymentData.accounts ?? [],
}

export function transactionExplorerUrl(hash: string): string | null {
  return explorerUrl ? `${explorerUrl}/tx/${hash}` : null
}

export function addressExplorerUrl(address: string): string | null {
  return explorerUrl ? `${explorerUrl}/address/${address}` : null
}

export function tokenExplorerUrl(tokenId: string): string | null {
  return explorerUrl
    ? `${explorerUrl}/token/${deployment.address}?a=${encodeURIComponent(tokenId)}`
    : null
}
