import { useCallback, useEffect, useState } from 'react'
import { BrowserProvider, type Eip1193Provider, type JsonRpcSigner } from 'ethers'
import { chainId as deployedChainId, contractAddress } from '../lib/contract'

interface InjectedProvider extends Eip1193Provider {
  on(event: 'accountsChanged', listener: (accounts: string[]) => void): void
  on(event: 'chainChanged', listener: (chainId: string) => void): void
  removeListener(event: 'accountsChanged', listener: (accounts: string[]) => void): void
  removeListener(event: 'chainChanged', listener: (chainId: string) => void): void
}

declare global {
  interface Window {
    ethereum?: InjectedProvider
  }
}

function errorMessage(error: unknown): string {
  const code = (error as { code?: number } | null)?.code
  if (code === 4001) {
    return 'Connection request was rejected. Approve the request in your wallet to continue.'
  }
  return error instanceof Error ? error.message : 'Could not connect to the wallet.'
}

export function useWallet() {
  const [account, setAccount] = useState<string | null>(null)
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null)
  const [provider, setProvider] = useState<BrowserProvider | null>(null)
  const [chainId, setChainId] = useState<bigint | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [walletRevision, setWalletRevision] = useState(0)
  const [deploymentCheck, setDeploymentCheck] = useState<{
    provider: BrowserProvider
    chainId: bigint
    deployed: boolean
  } | null>(null)

  const connect = useCallback(async () => {
    const injected = window.ethereum
    if (!injected) {
      setError('MetaMask is not installed. Install MetaMask to connect a demo account.')
      return
    }

    setError(null)
    try {
      const accounts = await injected.request({ method: 'eth_requestAccounts' })
      if (!Array.isArray(accounts) || accounts.length === 0) {
        throw new Error('No wallet account was returned.')
      }
      const browserProvider = new BrowserProvider(injected)
      const selectedAccount = String(accounts[0])
      const [network, walletSigner] = await Promise.all([
        browserProvider.getNetwork(),
        browserProvider.getSigner(selectedAccount),
      ])
      setAccount(selectedAccount)
      setSigner(walletSigner)
      setProvider(browserProvider)
      setChainId(network.chainId)
      setWalletRevision((revision) => revision + 1)
    } catch (connectError) {
      setError(errorMessage(connectError))
    }
  }, [])

  const switchNetwork = useCallback(async () => {
    const injected = window.ethereum
    if (!injected) {
      setError('MetaMask is not installed. Install MetaMask to connect a demo account.')
      return
    }

    const targetChainId = `0x${deployedChainId.toString(16)}`
    setError(null)
    try {
      await injected.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetChainId }],
      })
    } catch (switchError) {
      const code = (switchError as { code?: number } | null)?.code
      if (code !== 4902) {
        setError(errorMessage(switchError))
        return
      }

      try {
        await injected.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: targetChainId,
            chainName: 'Hardhat Local',
            rpcUrls: ['http://127.0.0.1:8545'],
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          }],
        })
        await injected.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: targetChainId }],
        })
      } catch (addError) {
        setError(errorMessage(addError))
      }
    }
  }, [])

  useEffect(() => {
    const injected = window.ethereum
    if (!injected) return

    const onAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        setAccount(null)
        setSigner(null)
        setProvider(null)
        setChainId(null)
        return
      }

      const browserProvider = new BrowserProvider(injected)
      const nextAccount = accounts[0]
      setAccount(nextAccount)
      setProvider(browserProvider)
      setWalletRevision((revision) => revision + 1)
      void Promise.all([
        browserProvider.getSigner(nextAccount),
        browserProvider.getNetwork(),
      ]).then(([nextSigner, network]) => {
        setSigner(nextSigner)
        setChainId(network.chainId)
      }).catch((eventError: unknown) => {
        setError(errorMessage(eventError))
      })
    }

    const onChainChanged = (newChainId: string) => {
      const browserProvider = new BrowserProvider(injected)
      setProvider(browserProvider)
      setChainId(BigInt(newChainId))
      setWalletRevision((revision) => revision + 1)
      if (account) {
        void browserProvider.getSigner(account).then(setSigner).catch((eventError: unknown) => {
          setError(errorMessage(eventError))
        })
      } else {
        setSigner(null)
      }
    }

    injected.on('accountsChanged', onAccountsChanged)
    injected.on('chainChanged', onChainChanged)
    return () => {
      injected.removeListener('accountsChanged', onAccountsChanged)
      injected.removeListener('chainChanged', onChainChanged)
    }
  }, [account])

  useEffect(() => {
    if (!provider || chainId !== BigInt(deployedChainId)) {
      return
    }

    let current = true
    void provider.getCode(contractAddress).then((code) => {
      if (current) {
        setDeploymentCheck({ provider, chainId, deployed: code !== '0x' })
      }
    }).catch((codeError: unknown) => {
      if (current) {
        setError(errorMessage(codeError))
      }
    })

    return () => {
      current = false
    }
  }, [chainId, provider])

  const contractDeployed =
    provider &&
    chainId === BigInt(deployedChainId) &&
    deploymentCheck?.provider === provider &&
    deploymentCheck.chainId === chainId
      ? deploymentCheck.deployed
      : null

  return {
    account,
    signer,
    provider,
    chainId,
    error,
    walletRevision,
    contractDeployed,
    connect,
    switchNetwork,
  }
}
