import { useCallback, useEffect, useState } from 'react'
import { BrowserProvider, type Eip1193Provider, type JsonRpcSigner } from 'ethers'
import { chainId as deployedChainId, contractAddress, labelFor } from '../lib/contract'

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
  const [activeAccount, setActiveAccount] = useState<string | null>(null)
  const [permittedAccounts, setPermittedAccounts] = useState<string[]>([])
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null)
  const [provider, setProvider] = useState<BrowserProvider | null>(null)
  const [chainId, setChainId] = useState<bigint | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [accountSelectionMessage, setAccountSelectionMessage] = useState<string | null>(null)
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
      await injected.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }],
      })
      const accounts = await injected.request({ method: 'eth_accounts' })
      if (!Array.isArray(accounts) || accounts.length === 0) {
        throw new Error('No wallet account was returned.')
      }
      const permitted = accounts.map(String)
      const browserProvider = new BrowserProvider(injected)
      const selectedAccount = permitted[0]
      const [network, walletSigner] = await Promise.all([
        browserProvider.getNetwork(),
        browserProvider.getSigner(selectedAccount),
      ])
      setPermittedAccounts(permitted)
      setActiveAccount(selectedAccount)
      setAccountSelectionMessage(null)
      setSigner(walletSigner)
      setProvider(browserProvider)
      setChainId(network.chainId)
      setWalletRevision((revision) => revision + 1)
    } catch (connectError) {
      setError(errorMessage(connectError))
    }
  }, [])

  const connectMoreAccounts = useCallback(async () => {
    const injected = window.ethereum
    if (!injected) {
      setError('MetaMask is not installed. Install MetaMask to connect a demo account.')
      return
    }

    setError(null)
    try {
      await injected.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }],
      })
      const accounts = await injected.request({ method: 'eth_accounts' })
      if (!Array.isArray(accounts) || accounts.length === 0) {
        throw new Error('No wallet account was permitted.')
      }

      const permitted = accounts.map(String)
      const browserProvider = new BrowserProvider(injected)
      const selectedAccount = permitted.find(
        (permittedAccount) => permittedAccount.toLowerCase() === activeAccount?.toLowerCase(),
      ) ?? permitted[0]
      const [network, walletSigner] = await Promise.all([
        browserProvider.getNetwork(),
        browserProvider.getSigner(selectedAccount),
      ])
      setPermittedAccounts(permitted)
      setActiveAccount(selectedAccount)
      setAccountSelectionMessage(null)
      setSigner(walletSigner)
      setProvider(browserProvider)
      setChainId(network.chainId)
      setWalletRevision((revision) => revision + 1)
    } catch (permissionError) {
      setError(errorMessage(permissionError))
    }
  }, [activeAccount])

  const requestAccountFallback = useCallback(async (accountLabel: string) => {
    const injected = window.ethereum
    if (!injected) {
      setError('MetaMask is not installed. Install MetaMask to connect a demo account.')
      return
    }

    setAccountSelectionMessage(`Select ${accountLabel} in MetaMask, then click Refresh`)
    try {
      await injected.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }],
      })
    } catch (permissionError) {
      setError(errorMessage(permissionError))
    }
  }, [])

  const selectAccount = useCallback(async (selectedAccount: string) => {
    if (!provider || !permittedAccounts.some(
      (permitted) => permitted.toLowerCase() === selectedAccount.toLowerCase(),
    )) {
      setError('That account is not connected in MetaMask. Connect more accounts to use it.')
      return
    }

    setError(null)
    try {
      const walletSigner = await provider.getSigner(selectedAccount)
      setActiveAccount(selectedAccount)
      setAccountSelectionMessage(null)
      setSigner(walletSigner)
      setWalletRevision((revision) => revision + 1)
    } catch (signerError) {
      if (isAccountSelectionRejection(signerError)) {
        await requestAccountFallback(labelFor(selectedAccount))
      } else {
        setError(errorMessage(signerError))
      }
    }
  }, [permittedAccounts, provider, requestAccountFallback])

  const refreshSelectedAccount = useCallback(async () => {
    const injected = window.ethereum
    if (!injected) return

    try {
      const accounts = await injected.request({ method: 'eth_accounts' })
      if (!Array.isArray(accounts) || accounts.length === 0) {
        throw new Error('No wallet account was returned.')
      }

      const permitted = accounts.map(String)
      const browserProvider = new BrowserProvider(injected)
      const selectedAccount = permitted[0]
      const [network, walletSigner] = await Promise.all([
        browserProvider.getNetwork(),
        browserProvider.getSigner(selectedAccount),
      ])
      setPermittedAccounts(permitted)
      setActiveAccount(selectedAccount)
      setSigner(walletSigner)
      setProvider(browserProvider)
      setChainId(network.chainId)
      setWalletRevision((revision) => revision + 1)
      setError(null)
      setAccountSelectionMessage(null)
    } catch (refreshError) {
      setError(errorMessage(refreshError))
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
      const permitted = accounts.map(String)
      setPermittedAccounts(permitted)
      if (accounts.length === 0) {
        setActiveAccount(null)
        setAccountSelectionMessage(null)
        setSigner(null)
        setProvider(null)
        setChainId(null)
        return
      }

      const browserProvider = new BrowserProvider(injected)
      const currentIsPermitted = permitted.some(
        (permittedAccount) => permittedAccount.toLowerCase() === activeAccount?.toLowerCase(),
      )
      const nextAccount = currentIsPermitted ? activeAccount as string : permitted[0]
      setActiveAccount(nextAccount)
      setAccountSelectionMessage(null)
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
      setAccountSelectionMessage(null)
      setWalletRevision((revision) => revision + 1)
      if (activeAccount) {
        void browserProvider.getSigner(activeAccount).then(setSigner).catch((eventError: unknown) => {
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
  }, [activeAccount])

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
    account: activeAccount,
    activeAccount,
    signer,
    provider,
    chainId,
    error,
    accountSelectionMessage,
    walletRevision,
    permittedAccounts,
    contractDeployed,
    connect,
    connectMoreAccounts,
    selectAccount,
    requestAccountFallback,
    refreshSelectedAccount,
    switchNetwork,
  }
}

function isAccountSelectionRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const details = error as { code?: string | number; message?: string; shortMessage?: string }
  const message = `${details.message ?? ''} ${details.shortMessage ?? ''}`.toLowerCase()
  return details.code === 4100 || /account.*(not selected|not authorized|unauthorized|not permitted)/.test(message)
}
