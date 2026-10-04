import { expect } from "chai";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("IdentityAssetRegistry asset lifecycle", function () {
  const didFor = (address: string) => `did:ethr:${address.toLowerCase()}`;

  let admin: Awaited<ReturnType<typeof ethers.getSigner>>;
  let alice: Awaited<ReturnType<typeof ethers.getSigner>>;
  let bob: Awaited<ReturnType<typeof ethers.getSigner>>;
  let registry: Awaited<ReturnType<typeof deployRegistry>>;

  async function deployRegistry() {
    return ethers.deployContract("IdentityAssetRegistry", [], admin);
  }

  async function register(account: typeof alice) {
    await registry.registerIdentity(account.address, didFor(account.address));
  }

  async function mintAsset() {
    await register(alice);
    await register(bob);
    await registry.mintAsset(alice.address, "Test certificate", "Lifecycle test");
  }

  beforeEach(async function () {
    [admin, alice, bob] = await ethers.getSigners();
    registry = await deployRegistry();
  });

  describe("setAssetExpiry", function () {
    it("sets a future expiry once and emits the complete event", async function () {
      await mintAsset();
      const latestBlock = await ethers.provider.getBlock("latest");
      expect(latestBlock).not.to.equal(null);
      const expiry = BigInt(latestBlock!.timestamp + 3600);

      await expect(registry.setAssetExpiry(1n, expiry))
        .to.emit(registry, "AssetExpirySet")
        .withArgs(1n, expiry, admin.address, anyValue);
      expect(await registry.expiresAt(1n)).to.equal(expiry);
      expect(await registry.expiryOf(1n)).to.equal(expiry);
    });

    it("rejects non-admin callers", async function () {
      await mintAsset();
      const expiry = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);

      await expect(registry.connect(alice).setAssetExpiry(1n, expiry))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("rejects an expiry in the past or at the current time", async function () {
      await mintAsset();
      const latestBlock = await ethers.provider.getBlock("latest");
      expect(latestBlock).not.to.equal(null);

      await expect(registry.setAssetExpiry(1n, BigInt(latestBlock!.timestamp)))
        .to.be.revertedWithCustomError(registry, "AssetExpiryNotFuture");
    });

    it("rejects a second expiry for the same asset", async function () {
      await mintAsset();
      const expiry = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
      await registry.setAssetExpiry(1n, expiry);

      await expect(registry.setAssetExpiry(1n, expiry + 1n))
        .to.be.revertedWithCustomError(registry, "AssetExpiryAlreadySet")
        .withArgs(1n);
    });

    it("rejects an expiry for a nonexistent asset", async function () {
      const expiry = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);

      await expect(registry.setAssetExpiry(99n, expiry))
        .to.be.revertedWithCustomError(registry, "AssetNotFound")
        .withArgs(99n);
    });
  });

  describe("revokeAsset", function () {
    it("permanently revokes an asset and emits the complete event", async function () {
      await mintAsset();
      const reason = "Superseded by corrected report";

      await expect(registry.revokeAsset(1n, reason))
        .to.emit(registry, "AssetRevoked")
        .withArgs(1n, admin.address, reason, anyValue);
      expect(await registry.revoked(1n)).to.equal(true);
      expect(await registry.isRevoked(1n)).to.equal(true);
    });

    it("rejects non-admin callers", async function () {
      await mintAsset();

      await expect(registry.connect(alice).revokeAsset(1n, "Not authorized"))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("rejects revocation twice and rejects nonexistent assets", async function () {
      await mintAsset();
      await registry.revokeAsset(1n, "First revocation");

      await expect(registry.revokeAsset(1n, "Second revocation"))
        .to.be.revertedWithCustomError(registry, "AssetAlreadyRevoked")
        .withArgs(1n);
      await expect(registry.revokeAsset(99n, "Missing"))
        .to.be.revertedWithCustomError(registry, "AssetNotFound")
        .withArgs(99n);
    });
  });

  describe("assetStatus", function () {
    it("reports valid, expired, and revoked states with revocation taking priority", async function () {
      await mintAsset();
      expect(await registry.assetStatus(1n)).to.equal(0n);

      const expiry = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 100);
      await registry.setAssetExpiry(1n, expiry);
      expect(await registry.assetStatus(1n)).to.equal(0n);

      await networkHelpers.time.increaseTo(expiry);
      expect(await registry.assetStatus(1n)).to.equal(1n);

      await registry.revokeAsset(1n, "Withdrawn");
      expect(await registry.assetStatus(1n)).to.equal(2n);
    });

    it("rejects lifecycle view calls for a nonexistent asset", async function () {
      await expect(registry.assetStatus(99n))
        .to.be.revertedWithCustomError(registry, "AssetNotFound");
      await expect(registry.isRevoked(99n))
        .to.be.revertedWithCustomError(registry, "AssetNotFound");
      await expect(registry.expiryOf(99n))
        .to.be.revertedWithCustomError(registry, "AssetNotFound");
    });
  });

  it("prevents a revoked asset from being transferred", async function () {
    await mintAsset();
    await registry.revokeAsset(1n, "Withdrawn");

    await expect(registry.connect(alice).transferFrom(alice.address, bob.address, 1n))
      .to.be.revertedWithCustomError(registry, "AssetIsRevoked")
      .withArgs(1n);
    expect(await registry.ownerOf(1n)).to.equal(alice.address);
  });
});
