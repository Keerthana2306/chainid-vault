# Identity Asset Registry

Hardhat 3 project for identity registration, role-based access control, and
registered-identity NFT asset management. The contract is implemented in
`contracts/IdentityAssetRegistry.sol` using OpenZeppelin Contracts v5.

## Tests

Run the TypeScript Mocha tests with:

```shell
npx hardhat test
```

## Local deployment

Start a local Hardhat node in one terminal:

```shell
npm run node
```

In another terminal, deploy the registry and seed demo identities and assets:

```shell
npm run deploy:local
```

The deployment address, ABI, and labeled demo account addresses are written to
`deployments/localhost.json`.
