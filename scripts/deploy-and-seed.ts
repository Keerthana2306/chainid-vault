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

await (
  await registry.mintAsset(alice.address, "Land Deed #1", "Demo deed for a registered property")
).wait();
await (
  await registry.mintAsset(
    alice.address,
    "Company Share Certificate",
    "Demo certificate representing company shares",
  )
).wait();
await (
  await registry.mintAsset(
    bob.address,
    "Equipment Warranty",
    "Demo warranty for registered equipment",
  )
).wait();

await (
  await registry.connect(alice).transferFrom(alice.address, bob.address, 1n)
).wait();

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
console.log("Seed assets: 3 minted; Alice transferred Land Deed #1 to Bob");
console.log("Deployment details: deployments/localhost.json\n");
