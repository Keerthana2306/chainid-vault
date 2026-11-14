import { readFile } from "node:fs/promises";
import { network } from "hardhat";

type SepoliaDeployment = {
  chainId: number;
  address: string;
  deployer: string;
};

const deployment = JSON.parse(
  await readFile(new URL("../deployments/sepolia.json", import.meta.url), "utf8"),
) as SepoliaDeployment;

if (
  deployment.chainId !== 11155111 ||
  !ethersIsAddress(deployment.address) ||
  !ethersIsAddress(deployment.deployer)
) {
  throw new Error("deployments/sepolia.json is missing valid Sepolia deployment details");
}

const { ethers } = await network.create({ network: "sepolia" });
const [deployer] = await ethers.getSigners();

if (!deployer) {
  throw new Error("Unable to load the Sepolia deployer signer");
}
if ((await ethers.provider.getNetwork()).chainId !== 11155111n) {
  throw new Error("The configured network is not Sepolia");
}
if (deployer.address.toLowerCase() !== deployment.deployer.toLowerCase()) {
  throw new Error("The configured Sepolia signer does not match the recorded deployer");
}

const registry = await ethers.getContractAt(
  "IdentityAssetRegistry",
  deployment.address,
  deployer,
);

const fingerprintForDemoFile = async (fileName: string) =>
  ethers.sha256(
    await readFile(new URL(`../demo-files/${fileName}`, import.meta.url)),
  )
    .slice(2)
    .toLowerCase();

await (
  await registry.registerIdentity(
    deployer.address,
    `did:ethr:${deployer.address.toLowerCase()}`,
  )
).wait();

const radarFingerprint = await fingerprintForDemoFile(
  "Radar Module RM-2041 Test Certificate.txt",
);
await (
  await registry.mintAsset(
    deployer.address,
    "Radar Module RM-2041 Test Certificate",
    `Factory acceptance test record for a radar subsystem batch (demo data) | sha256:${radarFingerprint}`,
  )
).wait();

const calibrationFingerprint = await fingerprintForDemoFile(
  "Test Equipment Calibration Certificate.txt",
);
await (
  await registry.mintAsset(
    deployer.address,
    "Test Equipment Calibration Certificate",
    `Calibration record for precision test equipment (demo data) | sha256:${calibrationFingerprint}`,
  )
).wait();

const latestBlock = await ethers.provider.getBlock("latest");
if (!latestBlock) {
  throw new Error("Unable to retrieve the latest Sepolia block for asset expiry");
}

const oneYearInSeconds = 365 * 24 * 60 * 60;
await (
  await registry.setAssetExpiry(
    2n,
    BigInt(latestBlock.timestamp + oneYearInSeconds),
  )
).wait();

console.log("Sepolia seed complete");
console.log(`Registered deployer identity: ${deployer.address}`);
console.log("Minted two demo assets with SHA-256 fingerprints from demo-files/");
console.log("Set an expiry on token #2");

function ethersIsAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}
