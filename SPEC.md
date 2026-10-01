# SIH26125: Blockchain-Based Secure Platform for Identity, Access Control and Digital Asset Management

## Problem statement (official text)
• Background Organizations today rely heavily on centralized identity and access management systems, which create significant security and operational risks. These systems are vulnerable to cyber attacks, identity theft, unauthorized access, and single points of failure. Additionally, digital and physical asset ownership is often managed through disconnected or semi-centralized systems, making verification of authenticity, access rights, and ownership history difficult and unreliable. There is a growing need for a decentralized, tamper-proof system that can securely manage user identities, control access permissions, and ensure transparent ownership of digital assets
• Detailed Description The system aims to introduce a blockchain-based framework that integrates decentralized identity management, access control, and NFT-based digital asset ownership. Each user is assigned a decentralized identifier, which serves as a secure and verifiable digital identity independent of centralized authorities and authenticated using cryptographic proofs. Digital assets are represented as Non-Fungible Tokens (NFTs),ensuring each asset is unique, traceable, and permanently recorded on the blockchain.These NFTs are directly allocated to user identities, establishing verifiable ownership that cannot be altered or duplicated.Smart contracts govern all operations within the platform, allowing only authorized administrators to mint NFTs and assign them to user identities, ensuring controlled asset creation and secure distribution. The system also implements Role-Based Access Control (RBAC), where administrators define roles such as Admin, Manager, Auditor,and User and assign specific access rights to each identity. These permissions are enforced automatically by smart contracts during all operations. Every activity, including identity creation, NFT creation, asset allocation, access rights assignment, ownership transfers, and permission updates, is immutably recorded on the blockchain, providing a transparent and tamper-proof audit trail for verifying ownership, authenticity, and access history.
• Expected Solution The expected solution is a decentralized blockchain-based platform that integrates secure digital identity management, NFT-based asset ownership, and access control into a unified and trustless system. It utilizes decentralized identifiers to provide users with self-sovereign, cryptographically verifiable identities that function independently of centralized authorities. Digital assets are issued as Non-Fungible Tokens (NFTs), ensuring uniqueness, traceability, and immutable ownership, with each NFT directly linked to a userâ€™s decentralized identity to establish a permanent and verifiable connection between assets and their owners.The system should be governed by smart contracts that enforce strict rules for NFT creation, allocation, transfer, and validation. Only authorized administrators are allowed to create NFTs and assign them to identities, ensuring secure and controlled asset governance while preventing unauthorized duplication or reassignment. Additionally, the platform should implement Role-Based Access Control (RBAC), where administrators define roles and assign access permissions that determine user privileges within the system. All identity operations, NFT transactions, and access control updates are permanently recorded on the blockchain, ensuring complete transparency, auditability,and tamper-proof verification of ownership, permissions, and transaction history.

## Stack
Hardhat 3 (ESM, Mocha + ethers v6), Solidity 0.8.x, OpenZeppelin Contracts v5. Local Hardhat network for demo, Sepolia optional.

## Contract: IdentityAssetRegistry.sol
One contract, inheriting ERC721 and AccessControl.

### Roles
- ADMIN (DEFAULT_ADMIN_ROLE): the deployer at start. Can register and revoke identities, assign and revoke roles, mint NFTs.
- MANAGER: can register identities (User role only) and view all data.
- AUDITOR: read-only access to all data and the audit trail. No write permissions.
- USER: can hold NFTs and transfer their own NFTs to other registered identities.

### Identity (DID)
- Each wallet address can be registered once, mapped to a DID string in the form `did:ethr:<address>`.
- Stored struct: did, registeredAt, active (bool).
- Revoked identities (active = false) cannot receive or transfer NFTs and cannot perform role-restricted actions.
- Functions: registerIdentity(address, did), revokeIdentity(address), getIdentity(address), isRegistered(address).

### NFTs (digital assets)
- Only ADMIN can mint, and only to an active registered identity.
- Each NFT has: tokenId, name, description (stored on-chain as strings), createdAt.
- Transfers allowed only between active registered identities (override `_update`).
- Prevent duplication or unauthorized reassignment.
- Functions: mintAsset(to, name, description), getAsset(tokenId), tokensOfOwner(address).

### RBAC
- Admin assigns and revokes roles (Manager, Auditor, User) to registered identities only.
- Enforced by smart contract modifiers in every function.
- The last Admin cannot be removed or renounce, to prevent lockout.
- Helper view: getRoles(address) for the frontend.

### Events (the immutable audit trail)
Every state change emits an event with the actor address and timestamp:
IdentityRegistered, IdentityRevoked, RoleAssigned, RoleRevoked, AssetMinted, AssetTransferred.

## Tests (Mocha, ethers v6)
Cover success and failure cases:
- Admin registers identity; non-admin cannot (Manager can register Users only).
- Duplicate registration reverts.
- Admin mints to registered identity; non-admin cannot; mint to unregistered reverts.
- Transfer between registered identities works; to unregistered or revoked reverts.
- Role assign and revoke; revoked identity loses access.
- Last Admin cannot be removed.
- Correct events emitted for every action.

## Out of scope
Real DID resolution, IPFS storage, mainnet deployment.