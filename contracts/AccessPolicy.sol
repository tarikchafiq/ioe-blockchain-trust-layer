// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IoERegistry.sol";

/// @title AccessPolicy - capability-style access control between IoE identities
/// @notice Policies are granted by the gateway responsible for the resource device.
///         Every on-chain access request is nonce-protected and logged (audit trail).
contract AccessPolicy {
    IoERegistry public immutable registry;

    // action bitmask: 1 = READ, 2 = WRITE/SETPOINT, 4 = CONTROL (e.g., curtail, disconnect)
    struct Policy { uint8 actions; uint64 expiry; }

    mapping(bytes32 => mapping(bytes32 => Policy)) public policies; // subject => resource => policy
    mapping(bytes32 => mapping(uint256 => bool)) public usedNonce;  // subject => nonce => used

    event PolicyGranted(bytes32 indexed subject, bytes32 indexed resource, uint8 actions, uint64 expiry);
    event PolicyRevoked(bytes32 indexed subject, bytes32 indexed resource);
    event AccessDecision(bytes32 indexed subject, bytes32 indexed resource, uint8 action, bool granted, uint256 nonce);

    error NotResourceGateway();
    error ReplayedNonce();
    error NotSubjectGateway();
    error InvalidAction();

    constructor(IoERegistry r) { registry = r; }

    function grant(bytes32 subject, bytes32 resource, uint8 actions, uint64 expiry) external {
        if (registry.gatewayOf(resource) != msg.sender) revert NotResourceGateway();
        if (actions == 0 || actions > 7) revert InvalidAction();
        policies[subject][resource] = Policy(actions, expiry);
        emit PolicyGranted(subject, resource, actions, expiry);
    }

    function revoke(bytes32 subject, bytes32 resource) external {
        if (registry.gatewayOf(resource) != msg.sender) revert NotResourceGateway();
        delete policies[subject][resource];
        emit PolicyRevoked(subject, resource);
    }

    function checkAccess(bytes32 subject, bytes32 resource, uint8 action) public view returns (bool) {
        if (!registry.isActive(subject) || !registry.isActive(resource)) return false;
        Policy memory p = policies[subject][resource];
        return (p.actions & action) == action && action != 0 && block.timestamp <= p.expiry;
    }

    /// @notice Logged, replay-protected request, submitted by the subject's gateway on its behalf.
    function requestAccess(bytes32 subject, bytes32 resource, uint8 action, uint256 nonce) external returns (bool granted) {
        if (registry.gatewayOf(subject) != msg.sender) revert NotSubjectGateway();
        if (usedNonce[subject][nonce]) revert ReplayedNonce();
        usedNonce[subject][nonce] = true;
        granted = checkAccess(subject, resource, action);
        emit AccessDecision(subject, resource, action, granted, nonce);
    }
}
