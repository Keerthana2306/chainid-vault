import { expect } from "chai";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("IdentityAssetRegistry", function () {
  const didFor = (address: string) => `did:ethr:${address.toLowerCase()}`;

  let admin: Awaited<ReturnType<typeof ethers.getSigner>>;
  let manager: Awaited<ReturnType<typeof ethers.getSigner>>;
  let auditor: Awaited<ReturnType<typeof ethers.getSigner>>;
  let alice: Awaited<ReturnType<typeof ethers.getSigner>>;
  let bob: Awaited<ReturnType<typeof ethers.getSigner>>;
  let outsider: Awaited<ReturnType<typeof ethers.getSigner>>;
  let registry: Awaited<ReturnType<typeof deployRegistry>>;

  async function deployRegistry() {
    return ethers.deployContract("IdentityAssetRegistry", [], admin);
  }

  beforeEach(async function () {
    [admin, manager, auditor, alice, bob, outsider] = await ethers.getSigners();
    registry = await deployRegistry();
  });

  async function register(account: typeof alice) {
    await registry.registerIdentity(account.address, didFor(account.address));
  }

  it("makes the deployer the initial admin and registers an identity with its DID", async function () {
    expect(await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    await expect(registry.deploymentTransaction())
      .to.emit(registry, "RoleAssigned")
      .withArgs(
        admin.address,
        await registry.DEFAULT_ADMIN_ROLE(),
        admin.address,
        anyValue,
      );

    const did = didFor(alice.address);
    const transaction = registry.registerIdentity(alice.address, did);
    await expect(transaction)
      .to.emit(registry, "IdentityRegistered")
      .withArgs(alice.address, did, admin.address, anyValue);
    await expect(transaction)
      .to.emit(registry, "RoleAssigned")
      .withArgs(alice.address, await registry.USER_ROLE(), admin.address, anyValue);

    const identity = await registry.getIdentity(alice.address);
    expect(identity.did).to.equal(did);
    expect(identity.registeredAt).to.be.greaterThan(0n);
    expect(identity.active).to.equal(true);
    expect(await registry.isRegistered(alice.address)).to.equal(true);
    expect(await registry.hasRole(await registry.USER_ROLE(), alice.address)).to.equal(true);
  });

  it("allows a manager to register users but not assign additional roles", async function () {
    await register(manager);
    await registry.assignRole(manager.address, await registry.MANAGER_ROLE());

    const did = didFor(alice.address);
    await expect(registry.connect(manager).registerIdentity(alice.address, did))
      .to.emit(registry, "IdentityRegistered")
      .withArgs(alice.address, did, manager.address, anyValue);
    expect(await registry.hasRole(await registry.USER_ROLE(), alice.address)).to.equal(true);
    expect(await registry.getRoles(alice.address)).to.deep.equal([await registry.USER_ROLE()]);

    await expect(
      registry.connect(manager).assignRole(alice.address, await registry.AUDITOR_ROLE()),
    ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
  });

  it("allows auditors to read registry data and audit events without write access", async function () {
    await register(auditor);
    await registry.assignRole(auditor.address, await registry.AUDITOR_ROLE());
    await register(alice);
    await registry.mintAsset(alice.address, "Laptop", "Company laptop");

    expect((await registry.connect(auditor).getIdentity(alice.address)).active).to.equal(true);
    expect((await registry.connect(auditor).getAsset(1n)).name).to.equal("Laptop");
    expect(await registry.connect(auditor).getRoles(auditor.address)).to.include(
      await registry.AUDITOR_ROLE(),
    );
    const registrationEvents = await registry.queryFilter(
      registry.filters.IdentityRegistered(alice.address),
    );
    expect(registrationEvents).to.have.length(1);

    await expect(
      registry.connect(auditor).registerIdentity(bob.address, didFor(bob.address)),
    ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    await expect(
      registry.connect(auditor).mintAsset(alice.address, "Unauthorized", "No"),
    ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    await expect(
      registry.connect(auditor).assignRole(alice.address, await registry.MANAGER_ROLE()),
    ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
  });

  it("rejects registration by non-admins and managers with invalid DIDs", async function () {
    await expect(
      registry.connect(outsider).registerIdentity(alice.address, didFor(alice.address)),
    ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");

    await register(manager);
    await registry.assignRole(manager.address, await registry.MANAGER_ROLE());
    await expect(
      registry.connect(manager).registerIdentity(alice.address, "did:ethr:invalid"),
    ).to.be.revertedWithCustomError(registry, "InvalidDID");
    await expect(
      registry.registerIdentity(ethers.ZeroAddress, didFor(ethers.ZeroAddress)),
    ).to.be.revertedWithCustomError(registry, "InvalidAddress");
  });

  it("rejects duplicate identity registration", async function () {
    await register(alice);
    await expect(
      registry.registerIdentity(alice.address, didFor(alice.address)),
    ).to.be.revertedWithCustomError(registry, "IdentityAlreadyRegistered");
    await registry.revokeIdentity(alice.address);
    await expect(
      registry.registerIdentity(alice.address, didFor(alice.address)),
    ).to.be.revertedWithCustomError(registry, "IdentityAlreadyRegistered");
  });

  it("mints assets only by admin to active registered identities and stores metadata", async function () {
    await register(alice);
    const transaction = registry.mintAsset(alice.address, "Laptop", "Company laptop");
    await expect(transaction)
      .to.emit(registry, "AssetMinted")
      .withArgs(1n, alice.address, admin.address, anyValue);

    const asset = await registry.getAsset(1n);
    expect(asset.name).to.equal("Laptop");
    expect(asset.description).to.equal("Company laptop");
    expect(asset.createdAt).to.be.greaterThan(0n);
    expect(await registry.ownerOf(1n)).to.equal(alice.address);
    expect(await registry.tokensOfOwner(alice.address)).to.deep.equal([1n]);

    await expect(
      registry.connect(outsider).mintAsset(alice.address, "Unauthorized", "No"),
    ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    await expect(
      registry.mintAsset(outsider.address, "Unregistered", "No"),
    ).to.be.revertedWithCustomError(registry, "IdentityNotRegistered");
  });

  it("rejects requests for metadata of nonexistent assets", async function () {
    await expect(registry.getAsset(1n)).to.be.revertedWithCustomError(
      registry,
      "AssetNotFound",
    );
  });

  it("allows transfers only between active registered identities", async function () {
    await register(alice);
    await register(bob);
    await registry.mintAsset(alice.address, "Badge", "Access badge");

    await expect(
      registry.connect(bob).transferFrom(alice.address, bob.address, 1n),
    )
      .to.be.revertedWithCustomError(registry, "ERC721InsufficientApproval")
      .withArgs(bob.address, 1n);
    await expect(registry.connect(alice).transferFrom(alice.address, bob.address, 1n))
      .to.emit(registry, "AssetTransferred")
      .withArgs(1n, alice.address, bob.address, alice.address, anyValue);
    expect(await registry.ownerOf(1n)).to.equal(bob.address);
    expect(await registry.tokensOfOwner(alice.address)).to.deep.equal([]);
    expect(await registry.tokensOfOwner(bob.address)).to.deep.equal([1n]);

    await expect(
      registry.connect(bob).transferFrom(bob.address, outsider.address, 1n),
    ).to.be.revertedWithCustomError(registry, "IdentityNotRegistered");
  });

  it("emits actor and timestamp audit events for ERC721 approval state changes", async function () {
    await register(alice);
    await register(bob);
    await registry.mintAsset(alice.address, "Badge", "Access badge");

    await expect(registry.connect(alice).approve(bob.address, 1n))
      .to.emit(registry, "AssetApprovalUpdated")
      .withArgs(1n, alice.address, bob.address, alice.address, anyValue);
    await expect(registry.connect(alice).setApprovalForAll(bob.address, true))
      .to.emit(registry, "OperatorApprovalUpdated")
      .withArgs(alice.address, bob.address, true, alice.address, anyValue);
    await expect(registry.connect(alice).setApprovalForAll(bob.address, false))
      .to.emit(registry, "OperatorApprovalUpdated")
      .withArgs(alice.address, bob.address, false, alice.address, anyValue);
  });

  it("prevents revoked identities from receiving, transferring, or performing role-restricted actions", async function () {
    await register(alice);
    await register(bob);
    await register(manager);
    await registry.assignRole(manager.address, await registry.MANAGER_ROLE());
    await registry.mintAsset(alice.address, "Badge", "Access badge");

    await expect(registry.revokeIdentity(bob.address))
      .to.emit(registry, "IdentityRevoked")
      .withArgs(bob.address, admin.address, anyValue);
    expect(await registry.isRegistered(bob.address)).to.equal(false);
    expect((await registry.getIdentity(bob.address)).active).to.equal(false);
    await expect(
      registry.mintAsset(bob.address, "Revoked", "Inactive identity"),
    ).to.be.revertedWithCustomError(registry, "IdentityInactive");

    await expect(
      registry.connect(alice).transferFrom(alice.address, bob.address, 1n),
    ).to.be.revertedWithCustomError(registry, "IdentityInactive");
    await registry.connect(alice).transferFrom(alice.address, manager.address, 1n);
    await registry.revokeIdentity(manager.address);
    await expect(
      registry.connect(manager).transferFrom(manager.address, alice.address, 1n),
    ).to.be.revertedWithCustomError(registry, "IdentityInactive");
    await expect(
      registry.connect(manager).registerIdentity(outsider.address, didFor(outsider.address)),
    ).to.be.revertedWithCustomError(registry, "IdentityInactive");
    await expect(registry.connect(outsider).revokeIdentity(alice.address)).to.be.revertedWithCustomError(
      registry,
      "AccessControlUnauthorizedAccount",
    );
    await expect(registry.revokeIdentity(bob.address)).to.be.revertedWithCustomError(
      registry,
      "IdentityNotActive",
    );
  });

  it("assigns and revokes roles with audit events and exposes them through getRoles", async function () {
    await register(alice);
    const managerRole = await registry.MANAGER_ROLE();

    await expect(registry.assignRole(alice.address, managerRole))
      .to.emit(registry, "RoleAssigned")
      .withArgs(alice.address, managerRole, admin.address, anyValue);
    expect(await registry.getRoles(alice.address)).to.include(managerRole);

    await expect(registry.revokeRole(managerRole, alice.address))
      .to.emit(registry, "RoleRevoked(address,bytes32,address,uint256)")
      .withArgs(alice.address, managerRole, admin.address, anyValue);
    expect(await registry.getRoles(alice.address)).to.not.include(managerRole);
    await expect(
      registry.connect(alice).registerIdentity(bob.address, didFor(bob.address)),
    ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    await expect(
      registry.assignRole(outsider.address, await registry.AUDITOR_ROLE()),
    ).to.be.revertedWithCustomError(registry, "IdentityNotRegistered");
    await expect(registry.assignRole(alice.address, ethers.id("UNKNOWN_ROLE"))).to.be.revertedWithCustomError(
      registry,
      "UnsupportedRole",
    );
  });

  it("removes NFT transfer access when USER_ROLE is revoked", async function () {
    await register(alice);
    await register(bob);
    await registry.mintAsset(alice.address, "Badge", "Access badge");
    await registry.revokeRole(await registry.USER_ROLE(), alice.address);

    await expect(
      registry.connect(alice).transferFrom(alice.address, bob.address, 1n),
    )
      .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
      .withArgs(alice.address, await registry.USER_ROLE());
    expect(await registry.ownerOf(1n)).to.equal(alice.address);
  });

  it("prevents a revoked identity from transferring as an approved operator", async function () {
    await register(alice);
    await register(bob);
    await register(manager);
    await registry.mintAsset(alice.address, "Badge", "Access badge");
    await registry.connect(alice).approve(manager.address, 1n);
    await registry.revokeIdentity(manager.address);

    await expect(
      registry.connect(manager).transferFrom(alice.address, bob.address, 1n),
    ).to.be.revertedWithCustomError(registry, "IdentityInactive");
    expect(await registry.ownerOf(1n)).to.equal(alice.address);
  });

  it("prevents removal or renunciation of the last admin", async function () {
    await register(admin);
    await expect(
      registry.revokeRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address),
    ).to.be.revertedWithCustomError(registry, "LastAdminCannotBeRemoved");
    await expect(
      registry.renounceRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address),
    ).to.be.revertedWithCustomError(registry, "LastAdminCannotBeRemoved");
    await expect(registry.revokeIdentity(admin.address)).to.be.revertedWithCustomError(
      registry,
      "LastAdminCannotBeRemoved",
    );

    await register(alice);
    await registry.assignRole(alice.address, await registry.DEFAULT_ADMIN_ROLE());
    await registry.revokeIdentity(alice.address);
    await expect(
      registry.revokeRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address),
    ).to.be.revertedWithCustomError(registry, "LastAdminCannotBeRemoved");
    await expect(
      registry.renounceRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address),
    ).to.be.revertedWithCustomError(registry, "LastAdminCannotBeRemoved");

    await register(bob);
    await registry.assignRole(bob.address, await registry.DEFAULT_ADMIN_ROLE());
    await expect(
      registry.revokeRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address),
    )
      .to.emit(registry, "RoleRevoked(address,bytes32,address,uint256)")
      .withArgs(admin.address, await registry.DEFAULT_ADMIN_ROLE(), admin.address, anyValue);
  });

  it("does not allow revoked administrators to manage roles", async function () {
    await register(alice);
    await registry.assignRole(alice.address, await registry.MANAGER_ROLE());
    await registry.revokeIdentity(alice.address);

    await expect(
      registry.connect(alice).registerIdentity(bob.address, didFor(bob.address)),
    ).to.be.revertedWithCustomError(registry, "IdentityInactive");
    await expect(
      registry.connect(alice).grantRole(await registry.AUDITOR_ROLE(), bob.address),
    ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
  });
});
