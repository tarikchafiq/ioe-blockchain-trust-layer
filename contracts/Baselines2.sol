// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BatchHashLog - stronger baseline: a gateway publishes all leaf hashes of a batch in ONE transaction
///        (event log, no storage). On-chain cost grows linearly with the batch size (calldata + log data).
contract BatchHashLog {
    event Batch(address indexed gateway, uint64 indexed seq, bytes32[] leaves);
    mapping(address => uint64) public lastSeq;
    function publish(uint64 seq, bytes32[] calldata leaves) external {
        require(seq == lastSeq[msg.sender] + 1, "seq");
        lastSeq[msg.sender] = seq;
        emit Batch(msg.sender, seq, leaves);
    }
}

/// @title DeviceHashChains - stronger baseline: one hash-chain head per device, updated by the gateway for
///        all its devices in ONE transaction per period. On-chain cost grows linearly with the fan-in k.
contract DeviceHashChains {
    mapping(bytes32 => bytes32) public head;   // did => current chain head
    mapping(bytes32 => uint64) public count;   // did => readings covered
    event Heads(address indexed gateway, uint256 n);
    function update(bytes32[] calldata dids, bytes32[] calldata batchHashes, uint32[] calldata n) external {
        require(dids.length == batchHashes.length && dids.length == n.length, "len");
        for (uint256 i = 0; i < dids.length; i++) {
            head[dids[i]] = keccak256(abi.encodePacked(head[dids[i]], batchHashes[i]));
            count[dids[i]] += n[i];
        }
        emit Heads(msg.sender, dids.length);
    }
}
