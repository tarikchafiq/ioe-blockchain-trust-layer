// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IoERegistry.sol";

/// @title AnchorRegistry - periodic Merkle-root anchoring of edge-aggregated measurements
/// @notice A gateway commits one root per batch; strict per-gateway sequence numbers make
///         batch replay, reordering and silent omission detectable.
contract AnchorRegistry {
    IoERegistry public immutable registry;

    struct Anchor { bytes32 root; uint32 leafCount; uint64 tStart; uint64 tEnd; uint64 anchoredAt; }

    mapping(address => uint64) public lastSeq;
    mapping(address => mapping(uint64 => Anchor)) public anchors;

    event Anchored(address indexed gateway, uint64 indexed seq, bytes32 root, uint32 leafCount, uint64 tStart, uint64 tEnd);

    error NotGateway();
    error BadSequence();
    error BadBatch();

    constructor(IoERegistry r) { registry = r; }

    function anchor(uint64 seq, bytes32 root, uint32 leafCount, uint64 tStart, uint64 tEnd) external {
        if (!registry.isGateway(msg.sender)) revert NotGateway();
        if (seq != lastSeq[msg.sender] + 1) revert BadSequence();
        if (root == bytes32(0) || leafCount == 0 || tEnd < tStart) revert BadBatch();
        lastSeq[msg.sender] = seq;
        anchors[msg.sender][seq] = Anchor(root, leafCount, tStart, tEnd, uint64(block.timestamp));
        emit Anchored(msg.sender, seq, root, leafCount, tStart, tEnd);
    }

    /// @notice Verifies that `leaf` (hash of a signed reading) is included in an anchored batch.
    ///         Uses sorted-pair hashing (position-independent), as in OpenZeppelin MerkleProof.
    function verifyInclusion(address gw, uint64 seq, bytes32 leaf, bytes32[] calldata proof) public view returns (bool) {
        bytes32 h = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            h = h < p ? keccak256(abi.encodePacked(h, p)) : keccak256(abi.encodePacked(p, h));
        }
        return anchors[gw][seq].root == h && h != bytes32(0);
    }

    /// @notice State-changing wrapper used only to meter the on-chain cost of a dispute check.
    event DisputeChecked(address indexed gw, uint64 indexed seq, bytes32 leaf, bool valid);
    function disputeCheck(address gw, uint64 seq, bytes32 leaf, bytes32[] calldata proof) external returns (bool ok) {
        ok = verifyInclusion(gw, seq, leaf, proof);
        emit DisputeChecked(gw, seq, leaf, ok);
    }
}
