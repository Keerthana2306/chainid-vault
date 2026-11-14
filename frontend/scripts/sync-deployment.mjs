import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadEnv } from 'vite'

const root = process.cwd()
const mode = process.argv[2] ?? 'development'
const env = loadEnv(mode, root, 'VITE_')
const selectedNetwork = process.env.VITE_NETWORK ?? env.VITE_NETWORK ?? 'local'

if (selectedNetwork !== 'local' && selectedNetwork !== 'sepolia') {
  throw new Error('VITE_NETWORK must be either "local" or "sepolia".')
}

const source = resolve(root, '..', 'deployments', `${selectedNetwork === 'local' ? 'localhost' : 'sepolia'}.json`)
const destinationDirectory = resolve(root, 'src', 'contract')
const destination = resolve(destinationDirectory, 'deployment.json')

await mkdir(destinationDirectory, { recursive: true })
await copyFile(source, destination)
console.log(`Synced ${selectedNetwork} deployment to src/contract/deployment.json`)
