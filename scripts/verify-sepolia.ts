import { readFile } from "node:fs/promises";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import hre from "hardhat";

type SepoliaDeployment = {
  chainId: number;
  address: string;
};

const deployment = JSON.parse(
  await readFile(new URL("../deployments/sepolia.json", import.meta.url), "utf8"),
) as SepoliaDeployment;

if (deployment.chainId !== 11155111 || !/^0x[0-9a-fA-F]{40}$/.test(deployment.address)) {
  throw new Error("deployments/sepolia.json is missing valid Sepolia deployment details");
}

await verifyContract(
  {
    address: deployment.address,
    constructorArgs: [],
    provider: "etherscan",
  },
  hre,
);

console.log(`Verified IdentityAssetRegistry at ${deployment.address} on Etherscan`);
