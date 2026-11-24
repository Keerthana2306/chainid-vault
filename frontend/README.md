# Frontend
See the [root README](../README.md) for project details.
Follow its local setup steps to install dependencies and run the app.
The frontend is React + Vite + TypeScript and uses ethers v6.
For tests, deployment, demo accounts, and limitations, use the root README.

Vercel API functions in `api/` require `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`; the signed upload and download routes also require
`RPC_URL` and `CHAIN_ID`. Configure a private Supabase Storage bucket named
`documents` and an `asset_metadata` table with a unique `token_id` plus `title`,
`description`, `filename`, `owner_address`, `sha256`, and `updated_at` columns.
The API stores the token owner's address in lowercase and reads the document
fingerprint from the on-chain asset description.

`POST /api/upload` and `POST /api/file` require a wallet signature over the
operation-specific message `ChainID Vault|<operation>|<tokenId>|<chainId>|<timestamp>`,
using a Unix timestamp in seconds no more than five minutes old.
`GET /api/metadata?tokenId=<tokenId>` returns only the public metadata fields.
