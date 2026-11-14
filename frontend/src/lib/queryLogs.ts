import { type Contract, type DeferredTopicFilter, type EventLog, type Log } from 'ethers'
import { deployment } from './network'

type EventFilter = string | DeferredTopicFilter

const LOG_CHUNK_SIZE = 2000
const MAX_ATTEMPTS = 3

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function queryFilterInChunks(
  contract: Contract,
  filter: EventFilter,
  fromBlock = deployment.deployBlock,
): Promise<(EventLog | Log)[]> {
  const provider = contract.runner?.provider
  if (!provider) {
    throw new Error('A provider is required to query contract events.')
  }

  const latestBlock = await provider.getBlockNumber()
  const logs: (EventLog | Log)[] = []

  for (let start = fromBlock; start <= latestBlock; start += LOG_CHUNK_SIZE) {
    const end = Math.min(start + LOG_CHUNK_SIZE - 1, latestBlock)
    let lastError: unknown
    let succeeded = false

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        logs.push(...await contract.queryFilter(filter, start, end))
        succeeded = true
        break
      } catch (error) {
        lastError = error
        if (attempt < MAX_ATTEMPTS) {
          await wait(250 * 2 ** (attempt - 1))
        }
      }
    }

    if (!succeeded) {
      throw lastError ?? new Error(`Could not query contract logs for blocks ${start}-${end}.`)
    }
  }

  return logs
}
