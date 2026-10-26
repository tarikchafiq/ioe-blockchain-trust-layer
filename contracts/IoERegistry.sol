// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IoERegistry - consortium-governed registry of gateways and device identities (DID-style)
/// @notice Layer-3 trust anchor: binds a device identifier to a public-key fingerprint,
///         a responsible edge gateway and a lifecycle status.
contract IoERegistry {
    enum Status { None, Active, Revoked }

    struct Device {
        bytes32 keyHash;     // keccak256 of the device public key (key material stays off-chain)
        address gateway;     // gateway responsible for the device
        uint8   deviceClass; // 0 meter, 1 inverter, 2 EV charger, 3 sensor, ...
        Status  status;
        uint64  registeredAt;
    }

    address public immutable admin;             // consortium governance account (multisig in production)
    mapping(address => bool) public isGateway;
    mapping(bytes32 => Device) private devices;

    event GatewaySet(address indexed gateway, bool enabled);
    event DeviceRegistered(bytes32 indexed did, address indexed gateway, uint8 deviceClass);
    event DeviceRevoked(bytes32 indexed did, address indexed by);
    event KeyRotated(bytes32 indexed did, bytes32 newKeyHash);

    error NotAdmin();
    error NotGateway();
    error AlreadyRegistered();
    error UnknownDevice();
    error NotResponsibleGateway();
    error ZeroValue();

    modifier onlyAdmin() { if (msg.sender != admin) revert NotAdmin(); _; }
    modifier onlyGateway() { if (!isGateway[msg.sender]) revert NotGateway(); _; }

    constructor() { admin = msg.sender; }

    function setGateway(address gw, bool enabled) external onlyAdmin {
        if (gw == address(0)) revert ZeroValue();
        isGateway[gw] = enabled;
        emit GatewaySet(gw, enabled);
    }

    function registerDevice(bytes32 did, bytes32 keyHash, uint8 deviceClass) external onlyGateway {
        if (did == bytes32(0) || keyHash == bytes32(0)) revert ZeroValue();
        if (devices[did].status != Status.None) revert AlreadyRegistered();
        devices[did] = Device(keyHash, msg.sender, deviceClass, Status.Active, uint64(block.timestamp));
        emit DeviceRegistered(did, msg.sender, deviceClass);
    }

    function rotateKey(bytes32 did, bytes32 newKeyHash) external {
        Device storage d = devices[did];
        if (d.status != Status.Active) revert UnknownDevice();
        if (d.gateway != msg.sender) revert NotResponsibleGateway();
        if (newKeyHash == bytes32(0)) revert ZeroValue();
        d.keyHash = newKeyHash;
        emit KeyRotated(did, newKeyHash);
    }

    function revokeDevice(bytes32 did) external {
        Device storage d = devices[did];
        if (d.status != Status.Active) revert UnknownDevice();
        if (d.gateway != msg.sender && msg.sender != admin) revert NotResponsibleGateway();
        d.status = Status.Revoked;
        emit DeviceRevoked(did, msg.sender);
    }

    function isActive(bytes32 did) external view returns (bool) {
        return devices[did].status == Status.Active;
    }

    function gatewayOf(bytes32 did) external view returns (address) { return devices[did].gateway; }

    function keyHashOf(bytes32 did) external view returns (bytes32) { return devices[did].keyHash; }
}
