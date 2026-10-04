import { mkdir, readFile, writeFile } from "node:fs/promises";
import { network } from "hardhat";

const { ethers } = await network.create({ network: "localhost" });
const signers = await ethers.getSigners();

if (signers.length < 5) {
  throw new Error(`Expected at least five localhost signers, received ${signers.length}`);
}

const [admin, manager, auditor, alice, bob] = signers;

if (!admin || !manager || !auditor || !alice || !bob) {
  throw new Error("Unable to load the five demo signers from the localhost network");
}

const roles = {
  admin: ethers.ZeroHash,
  manager: ethers.id("MANAGER"),
  auditor: ethers.id("AUDITOR"),
  user: ethers.id("USER"),
};

const registry = await ethers.deployContract("IdentityAssetRegistry", [], admin);
await registry.waitForDeployment();
const address = await registry.getAddress();

const registerIdentity = async (account: typeof admin) => {
  await (
    await registry.registerIdentity(
      account.address,
      `did:ethr:${account.address.toLowerCase()}`,
    )
  ).wait();
};

await registerIdentity(admin);
await registerIdentity(manager);
await (await registry.assignRole(manager.address, roles.manager)).wait();
await registerIdentity(auditor);
await (await registry.assignRole(auditor.address, roles.auditor)).wait();
await registerIdentity(alice);
await registerIdentity(bob);

const fingerprintForDemoFile = async (fileName: string) =>
  ethers.sha256(await readFile(new URL(`../demo-files/${fileName}`, import.meta.url)))
    .slice(2)
    .toLowerCase();

const demoFingerprints = {
  radar: await fingerprintForDemoFile("Radar Module RM-2041 Test Certificate.txt"),
  calibration: await fingerprintForDemoFile("Test Equipment Calibration Certificate.txt"),
  vendor: await fingerprintForDemoFile("Approved Vendor Qualification.txt"),
};

await (
  await registry.mintAsset(
    alice.address,
    "Radar Module RM-2041 Test Certificate",
    `Factory acceptance test record for a radar subsystem batch (demo data) | sha256:${demoFingerprints.radar}`,
  )
).wait();
await (
  await registry.mintAsset(
    alice.address,
    "Test Equipment Calibration Certificate",
    `Calibration record for precision test equipment (demo data) | sha256:${demoFingerprints.calibration}`,
  )
).wait();
await (
  await registry.mintAsset(
    bob.address,
    "Approved Vendor Qualification",
    `Qualification certificate for an approved component supplier (demo data) | sha256:${demoFingerprints.vendor}`,
  )
).wait();

await (
  await registry.connect(alice).transferFrom(alice.address, bob.address, 1n)
).wait();

const latestBlock = await ethers.provider.getBlock("latest");
if (!latestBlock) {
  throw new Error("Unable to read the latest block timestamp for lifecycle demo seeding");
}
const day = 24 * 60 * 60;
await (
  await registry.setAssetExpiry(1n, BigInt(latestBlock.timestamp + 365 * day))
).wait();
await (
  await registry.setAssetExpiry(2n, BigInt(latestBlock.timestamp + 20 * day))
).wait();
await (
  await registry.setAssetExpiry(3n, BigInt(latestBlock.timestamp + 365 * day))
).wait();
await (
  await registry.mintAsset(
    bob.address,
    "Withdrawn Component Test Report",
    "Superseded component test report (demo data)",
  )
).wait();
await (
  await registry.revokeAsset(4n, "Superseded by corrected report (demo)")
).wait();

const additionalAssets = [
  {
    name: "Secure Facility Access Policy Record",
    owner: admin,
    fileName: "Secure Facility Access Policy Record.txt",
    description: "Fictional secure facility access policy review",
    expiryDays: 365,
  },
  {
    name: "Software Release Approval Record",
    owner: admin,
    fileName: "Software Release Approval Record.txt",
    description: "Fictional release approval for embedded monitoring software",
    expiryDays: 365,
  },
  {
    name: "Production Line Clearance Certificate",
    owner: manager,
    fileName: "Production Line Clearance Certificate.txt",
    description: "Fictional production line clearance for an electronics batch",
    expiryDays: 12,
  },
  {
    name: "Unit Audit Closure Report",
    owner: manager,
    fileName: "Unit Audit Closure Report.txt",
    description: "Fictional unit audit closure for equipment controls",
    expiryDays: 365,
  },
  {
    name: "Quality Audit Findings Register Q3",
    owner: auditor,
    fileName: "Quality Audit Findings Register Q3.txt",
    description: "Fictional Q3 quality findings register for review",
    expiryDays: 365,
  },
  {
    name: "Vigilance Clearance Record",
    owner: auditor,
    fileName: "Vigilance Clearance Record.txt",
    description: "Fictional vigilance clearance record for review",
    expiryDays: 365,
  },
  {
    name: "Component Batch Inspection Report CBI-2026-0187",
    owner: alice,
    fileName: "Component Batch Inspection Report CBI-2026-0187.txt",
    description: "Fictional inspection record for component batch CBI-2026-0187",
    expiryDays: 365,
  },
  {
    name: "Environmental Stress Test Report",
    owner: alice,
    fileName: "Environmental Stress Test Report.txt",
    description: "Fictional environmental stress test summary for electronics",
    expiryDays: 1,
  },
  {
    name: "Firmware Integrity Certificate",
    owner: bob,
    fileName: "Firmware Integrity Certificate.txt",
    description: "Fictional firmware integrity verification record",
    expiryDays: 365,
  },
  {
    name: "Supplier Delivery Verification Record",
    owner: bob,
    fileName: "Supplier Delivery Verification Record.txt",
    description: "Fictional supplier delivery verification for electronics",
    expiryDays: 25,
  },
] as const;

const mintAdditionalDemoAsset = async (
  owner: typeof admin,
  name: string,
  description: string,
  fingerprint: string,
) => {
  const receipt = await (
    await registry.mintAsset(
      owner.address,
      name,
      `${description} (demo data) | sha256:${fingerprint}`,
    )
  ).wait();
  if (!receipt) {
    throw new Error(`Unable to read mint receipt for ${name}`);
  }

  const mintEventFragment = registry.interface.getEvent("AssetMinted");
  if (!mintEventFragment) {
    throw new Error("AssetMinted event is missing from the registry interface");
  }
  const mintTopic = mintEventFragment.topicHash;
  const mintLog = receipt.logs.find((log) => log.topics[0] === mintTopic);
  if (!mintLog) {
    throw new Error(`AssetMinted event was not emitted for ${name}`);
  }
  const parsedEvent = registry.interface.parseLog(mintLog);
  if (!parsedEvent || parsedEvent.name !== "AssetMinted") {
    throw new Error(`Unable to parse AssetMinted event for ${name}`);
  }
  return BigInt(parsedEvent.args.tokenId.toString());
};

const additionalAssetIds = new Map<string, bigint>();
for (const asset of additionalAssets) {
  const fingerprint = await fingerprintForDemoFile(asset.fileName);
  const tokenId = await mintAdditionalDemoAsset(
    asset.owner,
    asset.name,
    asset.description,
    fingerprint,
  );
  additionalAssetIds.set(asset.name, tokenId);
}

const additionalAssetId = (name: string) => {
  const tokenId = additionalAssetIds.get(name);
  if (tokenId === undefined) {
    throw new Error(`No minted token ID was recorded for ${name}`);
  }
  return tokenId;
};

for (const asset of additionalAssets) {
  const latestExpiryBlock = await ethers.provider.getBlock("latest");
  if (!latestExpiryBlock) {
    throw new Error(`Unable to read latest block timestamp for ${asset.name}`);
  }
  await (
    await registry.setAssetExpiry(
      additionalAssetId(asset.name),
      BigInt(latestExpiryBlock.timestamp + asset.expiryDays * day),
    )
  ).wait();
}

await (
  await registry.revokeAsset(
    additionalAssetId("Vigilance Clearance Record"),
    "Issued in error (demo)",
  )
).wait();

const assertTransferSigner = async (account: typeof admin, label: string) => {
  const identity = await registry.getIdentity(account.address);
  if (!identity.active) {
    throw new Error(`Seed transfer failed: ${label} has no active identity`);
  }
  if (!(await registry.hasRole(roles.user, account.address))) {
    throw new Error(`Seed transfer failed: ${label} does not have the User role`);
  }
};

await assertTransferSigner(bob, "Bob");
await (
  await registry
    .connect(bob)
    .transferFrom(
      bob.address,
      alice.address,
      additionalAssetId("Firmware Integrity Certificate"),
    )
).wait();
await assertTransferSigner(alice, "Alice");
await (
  await registry
    .connect(alice)
    .transferFrom(
      alice.address,
      manager.address,
      additionalAssetId("Component Batch Inspection Report CBI-2026-0187"),
    )
).wait();
await assertTransferSigner(manager, "Manager");
await (
  await registry
    .connect(manager)
    .transferFrom(
      manager.address,
      admin.address,
      additionalAssetId("Unit Audit Closure Report"),
    )
).wait();

await ethers.provider.send("evm_increaseTime", [172800]);
await ethers.provider.send("evm_mine", []);

const roleAssignments = [
  ["Admin", admin, roles.admin],
  ["Manager", manager, roles.manager],
  ["Auditor", auditor, roles.auditor],
  ["Alice", alice, roles.user],
  ["Bob", bob, roles.user],
] as const;
for (const [label, account, role] of roleAssignments) {
  if (!(await registry.hasRole(role, account.address))) {
    throw new Error(`Seed validation failed: ${label} is missing the expected role`);
  }
}

const artifactUrl = new URL(
  "../artifacts/contracts/IdentityAssetRegistry.sol/IdentityAssetRegistry.json",
  import.meta.url,
);
const artifact = JSON.parse(await readFile(artifactUrl, "utf8")) as {
  abi: unknown[];
};
const chainId = Number((await ethers.provider.getNetwork()).chainId);
const deployment = {
  chainId,
  address,
  abi: artifact.abi,
  accounts: [
    { label: "Admin", address: admin.address },
    { label: "Manager", address: manager.address },
    { label: "Auditor", address: auditor.address },
    { label: "Alice", address: alice.address },
    { label: "Bob", address: bob.address },
  ],
};

const deploymentsDirectory = new URL("../deployments/", import.meta.url);
await mkdir(deploymentsDirectory, { recursive: true });
await writeFile(
  new URL("localhost.json", deploymentsDirectory),
  JSON.stringify(
    deployment,
    (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ) + "\n",
);

console.log("\nIdentityAssetRegistry deployed and seeded");
console.log(`Contract: ${address}`);
console.log(`Chain ID: ${chainId}`);
console.log("Demo accounts:");
console.log(`  Admin   ${admin.address} (DEFAULT_ADMIN_ROLE)`);
console.log(`  Manager ${manager.address} (MANAGER_ROLE)`);
console.log(`  Auditor ${auditor.address} (AUDITOR_ROLE)`);
console.log(`  Alice   ${alice.address} (USER_ROLE)`);
console.log(`  Bob     ${bob.address} (USER_ROLE)`);
console.log("Seed assets: 4 minted; Alice transferred Radar Module RM-2041 Test Certificate to Bob");
console.log("Lifecycle: calibration expires in 20 days; Withdrawn Component Test Report is revoked");
console.log("Deployment details: deployments/localhost.json\n");
const ownerLabels = new Map(
  [
    [admin.address.toLowerCase(), "Admin"],
    [manager.address.toLowerCase(), "Manager"],
    [auditor.address.toLowerCase(), "Auditor"],
    [alice.address.toLowerCase(), "Alice"],
    [bob.address.toLowerCase(), "Bob"],
  ] as const,
);
const summaryBlock = await ethers.provider.getBlock("latest");
if (!summaryBlock) {
  throw new Error("Unable to read the latest block for the seeded asset summary");
}
const summaryNow = BigInt(summaryBlock.timestamp);
const assetMintEvents = await registry.queryFilter(registry.filters.AssetMinted());
const assetSummary = await Promise.all(
  assetMintEvents.map(async (event) => {
    if (!("args" in event)) {
      throw new Error("Unable to read AssetMinted arguments for the seeded asset summary");
    }
    const tokenId = event.args.tokenId;
    const asset = await registry.getAsset(tokenId);
    const ownerAddress = await registry.ownerOf(tokenId);
    const statusCode = Number(await registry.assetStatus(tokenId));
    const expiry = BigInt(await registry.expiryOf(tokenId));
    let status: string;
    if (statusCode === 2) {
      status = "Revoked";
    } else if (statusCode === 1) {
      status = "Expired";
    } else if (statusCode === 0) {
      status =
        expiry !== 0n && expiry <= summaryNow + BigInt(30 * day)
          ? "Expiring soon"
          : "Valid";
    } else {
      throw new Error(`Unexpected lifecycle status ${statusCode} for token ${tokenId}`);
    }
    const ownerLabel =
      ownerLabels.get(ownerAddress.toLowerCase()) ??
      `Account ${ownerAddress.slice(0, 6)}`;
    return {
      "Token ID": tokenId.toString(),
      Name: asset.name,
      "Current owner": ownerLabel,
      Status: status,
    };
  }),
);
console.log("All seeded assets:");
console.table(assetSummary);
