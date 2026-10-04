// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract IdentityAssetRegistry is ERC721, AccessControl {
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER");
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR");
    bytes32 public constant USER_ROLE = keccak256("USER");

    struct Identity {
        string did;
        uint256 registeredAt;
        bool active;
    }

    struct Asset {
        string name;
        string description;
        uint256 createdAt;
    }

    mapping(address => Identity) private _identities;
    mapping(uint256 => Asset) private _assets;
    mapping(uint256 => uint64) public expiresAt;
    mapping(uint256 => bool) public revoked;
    uint256 private _nextTokenId = 1;
    uint256 private _activeAdminCount;

    error InvalidAddress();
    error InvalidDID();
    error IdentityAlreadyRegistered(address account);
    error IdentityNotRegistered(address account);
    error IdentityInactive(address account);
    error IdentityNotActive(address account);
    error UnsupportedRole(bytes32 role);
    error LastAdminCannotBeRemoved();
    error AssetNotFound(uint256 tokenId);
    error AssetExpiryAlreadySet(uint256 tokenId);
    error AssetExpiryNotFuture(uint64 expiry);
    error AssetAlreadyRevoked(uint256 tokenId);
    error AssetIsRevoked(uint256 tokenId);

    event IdentityRegistered(
        address indexed account,
        string did,
        address indexed actor,
        uint256 timestamp
    );
    event IdentityRevoked(
        address indexed account,
        address indexed actor,
        uint256 timestamp
    );
    event RoleAssigned(
        address indexed account,
        bytes32 indexed role,
        address indexed actor,
        uint256 timestamp
    );
    event RoleRevoked(
        address indexed account,
        bytes32 indexed role,
        address indexed actor,
        uint256 timestamp
    );
    event AssetMinted(
        uint256 indexed tokenId,
        address indexed to,
        address indexed actor,
        uint256 timestamp
    );
    event AssetTransferred(
        uint256 indexed tokenId,
        address indexed from,
        address indexed to,
        address actor,
        uint256 timestamp
    );
    event AssetExpirySet(
        uint256 indexed tokenId,
        uint64 expiry,
        address indexed actor,
        uint256 timestamp
    );
    event AssetRevoked(
        uint256 indexed tokenId,
        address indexed actor,
        string reason,
        uint256 timestamp
    );
    event AssetApprovalUpdated(
        uint256 indexed tokenId,
        address indexed owner,
        address indexed approved,
        address actor,
        uint256 timestamp
    );
    event OperatorApprovalUpdated(
        address indexed owner,
        address indexed operator,
        bool approved,
        address actor,
        uint256 timestamp
    );

    constructor() ERC721("IdentityAssetRegistry", "IAR") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        emit RoleAssigned(msg.sender, DEFAULT_ADMIN_ROLE, msg.sender, block.timestamp);
    }

    modifier onlyActiveRole(bytes32 role) {
        _checkRole(role);
        _requireActorNotRevoked();
        _;
    }

    function registerIdentity(address account, string calldata did) external {
        _requireActorNotRevoked();
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender) && !hasRole(MANAGER_ROLE, msg.sender)) {
            _checkRole(MANAGER_ROLE);
        }
        if (account == address(0)) revert InvalidAddress();
        if (bytes(_identities[account].did).length != 0) {
            revert IdentityAlreadyRegistered(account);
        }

        string memory expectedDID = string.concat(
            "did:ethr:",
            Strings.toHexString(uint256(uint160(account)), 20)
        );
        if (keccak256(bytes(did)) != keccak256(bytes(expectedDID))) revert InvalidDID();

        uint256 timestamp = block.timestamp;
        _identities[account] = Identity({did: did, registeredAt: timestamp, active: true});
        _grantRole(USER_ROLE, account);

        emit IdentityRegistered(account, did, msg.sender, timestamp);
        emit RoleAssigned(account, USER_ROLE, msg.sender, timestamp);
    }

    function revokeIdentity(address account) external onlyActiveRole(DEFAULT_ADMIN_ROLE) {
        _requireRegistered(account);
        Identity storage identity = _identities[account];
        if (!identity.active) revert IdentityNotActive(account);
        if (hasRole(DEFAULT_ADMIN_ROLE, account) && _activeAdminCount <= 1) {
            revert LastAdminCannotBeRemoved();
        }

        identity.active = false;
        if (hasRole(DEFAULT_ADMIN_ROLE, account)) {
            _activeAdminCount -= 1;
        }
        emit IdentityRevoked(account, msg.sender, block.timestamp);
    }

    function getIdentity(address account) external view returns (Identity memory) {
        return _identities[account];
    }

    function isRegistered(address account) external view returns (bool) {
        return _identities[account].active;
    }

    function assignRole(
        address account,
        bytes32 role
    ) external onlyActiveRole(DEFAULT_ADMIN_ROLE) {
        _assignRole(account, role, msg.sender);
    }

    function grantRole(
        bytes32 role,
        address account
    ) public override onlyActiveRole(DEFAULT_ADMIN_ROLE) {
        _assignRole(account, role, msg.sender);
    }

    function revokeRole(
        bytes32 role,
        address account
    ) public override onlyActiveRole(DEFAULT_ADMIN_ROLE) {
        _requireRegistered(account);
        _requireSupportedRole(role);
        if (
            role == DEFAULT_ADMIN_ROLE &&
            _identities[account].active &&
            _activeAdminCount <= 1
        ) {
            revert LastAdminCannotBeRemoved();
        }
        if (_revokeRole(role, account)) {
            emit RoleRevoked(account, role, msg.sender, block.timestamp);
        }
    }

    function renounceRole(bytes32 role, address callerConfirmation) public override {
        if (callerConfirmation != msg.sender) revert AccessControlBadConfirmation();
        _requireActorNotRevoked();
        _requireSupportedRole(role);
        if (role == DEFAULT_ADMIN_ROLE && _activeAdminCount <= 1) {
            revert LastAdminCannotBeRemoved();
        }
        if (_revokeRole(role, msg.sender)) {
            emit RoleRevoked(msg.sender, role, msg.sender, block.timestamp);
        }
    }

    function getRoles(address account) external view returns (bytes32[] memory roles) {
        uint256 count;
        if (hasRole(DEFAULT_ADMIN_ROLE, account)) count += 1;
        if (hasRole(MANAGER_ROLE, account)) count += 1;
        if (hasRole(AUDITOR_ROLE, account)) count += 1;
        if (hasRole(USER_ROLE, account)) count += 1;

        roles = new bytes32[](count);
        uint256 index;
        if (hasRole(DEFAULT_ADMIN_ROLE, account)) roles[index++] = DEFAULT_ADMIN_ROLE;
        if (hasRole(MANAGER_ROLE, account)) roles[index++] = MANAGER_ROLE;
        if (hasRole(AUDITOR_ROLE, account)) roles[index++] = AUDITOR_ROLE;
        if (hasRole(USER_ROLE, account)) roles[index] = USER_ROLE;
    }

    function mintAsset(
        address to,
        string calldata name,
        string calldata description
    ) external onlyActiveRole(DEFAULT_ADMIN_ROLE) returns (uint256 tokenId) {
        _requireActiveIdentity(to);
        tokenId = _nextTokenId++;
        _assets[tokenId] = Asset({
            name: name,
            description: description,
            createdAt: block.timestamp
        });
        _safeMint(to, tokenId);
        emit AssetMinted(tokenId, to, msg.sender, block.timestamp);
    }

    function getAsset(uint256 tokenId) external view returns (Asset memory) {
        if (_ownerOf(tokenId) == address(0)) revert AssetNotFound(tokenId);
        return _assets[tokenId];
    }

    function setAssetExpiry(
        uint256 tokenId,
        uint64 expiry
    ) external onlyActiveRole(DEFAULT_ADMIN_ROLE) {
        _requireAssetExists(tokenId);
        if (expiresAt[tokenId] != 0) revert AssetExpiryAlreadySet(tokenId);
        if (expiry <= block.timestamp) revert AssetExpiryNotFuture(expiry);
        expiresAt[tokenId] = expiry;
        emit AssetExpirySet(tokenId, expiry, msg.sender, block.timestamp);
    }

    function revokeAsset(
        uint256 tokenId,
        string calldata reason
    ) external onlyActiveRole(DEFAULT_ADMIN_ROLE) {
        _requireAssetExists(tokenId);
        if (revoked[tokenId]) revert AssetAlreadyRevoked(tokenId);
        revoked[tokenId] = true;
        emit AssetRevoked(tokenId, msg.sender, reason, block.timestamp);
    }

    function isRevoked(uint256 tokenId) external view returns (bool) {
        _requireAssetExists(tokenId);
        return revoked[tokenId];
    }

    function expiryOf(uint256 tokenId) external view returns (uint64) {
        _requireAssetExists(tokenId);
        return expiresAt[tokenId];
    }

    function assetStatus(uint256 tokenId) external view returns (uint8) {
        _requireAssetExists(tokenId);
        if (revoked[tokenId]) return 2;
        uint64 expiry = expiresAt[tokenId];
        if (expiry != 0 && block.timestamp >= expiry) return 1;
        return 0;
    }

    function tokensOfOwner(address account) external view returns (uint256[] memory tokens) {
        uint256 ownedCount;
        for (uint256 tokenId = 1; tokenId < _nextTokenId; tokenId++) {
            if (_ownerOf(tokenId) == account) ownedCount += 1;
        }

        tokens = new uint256[](ownedCount);
        uint256 index;
        for (uint256 tokenId = 1; tokenId < _nextTokenId; tokenId++) {
            if (_ownerOf(tokenId) == account) tokens[index++] = tokenId;
        }
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address from) {
        from = _ownerOf(tokenId);
        if (from != address(0)) {
            if (revoked[tokenId]) revert AssetIsRevoked(tokenId);
            _requireActiveIdentity(from);
            _requireActiveIdentity(auth);
            _checkRole(USER_ROLE, from);
            _checkRole(USER_ROLE, auth);
        }
        if (to != address(0)) _requireActiveIdentity(to);

        from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0)) {
            emit AssetTransferred(tokenId, from, to, msg.sender, block.timestamp);
        }
    }

    function _approve(
        address to,
        uint256 tokenId,
        address auth,
        bool emitEvent
    ) internal override {
        super._approve(to, tokenId, auth, emitEvent);
        if (emitEvent) {
            emit AssetApprovalUpdated(
                tokenId,
                ownerOf(tokenId),
                to,
                auth,
                block.timestamp
            );
        }
    }

    function _setApprovalForAll(
        address owner,
        address operator,
        bool approved
    ) internal override {
        super._setApprovalForAll(owner, operator, approved);
        emit OperatorApprovalUpdated(owner, operator, approved, owner, block.timestamp);
    }

    function _assignRole(address account, bytes32 role, address actor) private {
        _requireActiveIdentity(account);
        _requireSupportedRole(role);
        if (_grantRole(role, account)) {
            emit RoleAssigned(account, role, actor, block.timestamp);
        }
    }

    function _requireSupportedRole(bytes32 role) private pure {
        if (
            role != DEFAULT_ADMIN_ROLE &&
            role != MANAGER_ROLE &&
            role != AUDITOR_ROLE &&
            role != USER_ROLE
        ) {
            revert UnsupportedRole(role);
        }
    }

    function _requireRegistered(address account) private view {
        if (bytes(_identities[account].did).length == 0) {
            revert IdentityNotRegistered(account);
        }
    }

    function _requireAssetExists(uint256 tokenId) private view {
        if (_ownerOf(tokenId) == address(0)) revert AssetNotFound(tokenId);
    }

    function _requireActiveIdentity(address account) private view {
        if (bytes(_identities[account].did).length == 0) {
            revert IdentityNotRegistered(account);
        }
        if (!_identities[account].active) revert IdentityInactive(account);
    }

    function _requireActorNotRevoked() private view {
        Identity storage identity = _identities[msg.sender];
        if (bytes(identity.did).length != 0 && !identity.active) {
            revert IdentityInactive(msg.sender);
        }
    }

    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        bool granted = super._grantRole(role, account);
        if (granted && role == DEFAULT_ADMIN_ROLE) {
            if (bytes(_identities[account].did).length == 0 || _identities[account].active) {
                _activeAdminCount += 1;
            }
        }
        return granted;
    }

    function _revokeRole(bytes32 role, address account) internal override returns (bool) {
        bool roleWasRevoked = super._revokeRole(role, account);
        if (roleWasRevoked && role == DEFAULT_ADMIN_ROLE) {
            if (bytes(_identities[account].did).length == 0 || _identities[account].active) {
                _activeAdminCount -= 1;
            }
        }
        return roleWasRevoked;
    }
}
