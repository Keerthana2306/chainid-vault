import { mkdir, readFile, writeFile } from "node:fs/promises";
import { network } from "hardhat";

const { ethers } = await network.create({ network: "sepolia" });
const [deployer] = await ethers.getSigners();

if (!deployer) {
  throw new Error("Unable to load the Sepolia deployer signer");
}

const chainId = (await ethers.provider.getNetwork()).chainId;
if (chainId !== 11155111n) {
  throw new Error(`Expected Sepolia chain ID 11155111, received ${chainId}`);
}

const registry = await ethers.deployContract("IdentityAssetRegistry", [], deployer);
const deploymentTransaction = registry.deploymentTransaction();
if (!deploymentTransaction) {
  throw new Error("Unable to retrieve the IdentityAssetRegistry deployment transaction");
}

const receipt = await deploymentTransaction.wait(2);
if (!receipt) {
  throw new Error("Unable to retrieve the confirmed deployment receipt");
}

const address = await registry.getAddress();
const deploymentBlock = await ethers.provider.getBlock(receipt.blockNumber);
if (!deploymentBlock) {
  throw new Error(`Unable to retrieve deployment block ${receipt.blockNumber}`);
}

const artifact = JSON.parse(
  await readFile(
    new URL(
      "../artifacts/contracts/IdentityAssetRegistry.sol/IdentityAssetRegistry.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { abi: unknown[] };

const deployment = {
  chainId: Number(chainId),
  address,
  abi: artifact.abi,
  deployBlockNumber: receipt.blockNumber,
  deployer: deployer.address,
  timestamp: new Date(deploymentBlock.timestamp * 1000).toISOString(),
};

const deploymentsDirectory = new URL("../deployments/", import.meta.url);
await mkdir(deploymentsDirectory, { recursive: true });
await writeFile(
  new URL("sepolia.json", deploymentsDirectory),
  `${JSON.stringify(deployment, null, 2)}\n`,
);

console.log("IdentityAssetRegistry deployed to Sepolia");
console.log(`Contract: ${address}`);
console.log(`Chain ID: ${chainId}`);
console.log(`Deployment block: ${receipt.blockNumber}`);
console.log(`Deployer: ${deployer.address}`);
console.log("Deployment details: deployments/sepolia.json");
