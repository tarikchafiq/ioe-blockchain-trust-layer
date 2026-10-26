// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IoERegistry.sol";

/// @title EnergyMarketV2 - P2P trading settled by a meter-signed delivery attestation
/// @notice Removes the "trusted gateway oracle" assumption of EnergyMarket: settlement requires an
///         ECDSA signature by the seller's meter key whose hash is registered in IoERegistry
///         (keyHash = keccak256(abi.encodePacked(meterSigningAddress))). The attestation is bound to
///         chain id, this contract, the offer id, the meter DID and the delivered energy, so it cannot be
///         replayed on another offer, another market or another chain. Anyone may relay it.
contract EnergyMarketV2 {
    IoERegistry public immutable registry;

    enum State { None, Open, Accepted, Settled, Refunded }
    struct Offer { address seller; address buyer; bytes32 meterDid; uint64 energyWh; uint128 pricePerWh; uint64 deadline; State state; }

    uint256 public nextId = 1;
    mapping(uint256 => Offer) public offers;
    mapping(address => uint256) public credit;

    event OfferCreated(uint256 indexed id, address indexed seller, bytes32 meterDid, uint64 energyWh, uint128 pricePerWh, uint64 deadline);
    event OfferAccepted(uint256 indexed id, address indexed buyer, uint256 escrow);
    event Settled(uint256 indexed id, uint64 deliveredWh, uint256 paid, uint256 refunded, address relayer);
    event Refunded(uint256 indexed id, uint256 amount);

    error InactiveMeter(); error BadOffer(); error BadState(); error WrongPayment(); error BadAttestation();
    error OverDelivery(); error TooEarly(); error NothingToWithdraw(); error TransferFailed();

    constructor(IoERegistry r) { registry = r; }

    function createOffer(bytes32 meterDid, uint64 energyWh, uint128 pricePerWh, uint64 deadline) external returns (uint256 id) {
        if (!registry.isActive(meterDid)) revert InactiveMeter();
        if (energyWh == 0 || pricePerWh == 0 || deadline <= block.timestamp) revert BadOffer();
        id = nextId++;
        offers[id] = Offer(msg.sender, address(0), meterDid, energyWh, pricePerWh, deadline, State.Open);
        emit OfferCreated(id, msg.sender, meterDid, energyWh, pricePerWh, deadline);
    }

    function acceptOffer(uint256 id) external payable {
        Offer storage o = offers[id];
        if (o.state != State.Open || block.timestamp > o.deadline) revert BadState();
        uint256 cost = uint256(o.energyWh) * o.pricePerWh;
        if (msg.value != cost) revert WrongPayment();
        o.buyer = msg.sender; o.state = State.Accepted;
        emit OfferAccepted(id, msg.sender, cost);
    }

    /// @notice Digest the meter signs (EIP-191 personal_sign over this 32-byte hash).
    function attestationDigest(uint256 id, bytes32 meterDid, uint64 deliveredWh) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), id, meterDid, deliveredWh));
    }

    function settleAttested(uint256 id, uint64 deliveredWh, uint8 v, bytes32 r, bytes32 s) external {
        Offer storage o = offers[id];
        if (o.state != State.Accepted) revert BadState();
        if (deliveredWh > o.energyWh) revert OverDelivery();
        if (!registry.isActive(o.meterDid)) revert InactiveMeter();
        // reject malleable signatures (upper half of the curve order), as in EIP-2
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert BadAttestation();
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", attestationDigest(id, o.meterDid, deliveredWh)));
        address signer = ecrecover(ethHash, v, r, s);
        if (signer == address(0) || keccak256(abi.encodePacked(signer)) != registry.keyHashOf(o.meterDid)) revert BadAttestation();
        o.state = State.Settled;
        uint256 paid = uint256(deliveredWh) * o.pricePerWh;
        uint256 refund = uint256(o.energyWh - deliveredWh) * o.pricePerWh;
        credit[o.seller] += paid;
        if (refund > 0) credit[o.buyer] += refund;
        emit Settled(id, deliveredWh, paid, refund, msg.sender);
    }

    function refundExpired(uint256 id) external {
        Offer storage o = offers[id];
        if (o.state != State.Accepted) revert BadState();
        if (block.timestamp <= o.deadline) revert TooEarly();
        o.state = State.Refunded;
        uint256 amt = uint256(o.energyWh) * o.pricePerWh;
        credit[o.buyer] += amt;
        emit Refunded(id, amt);
    }

    function withdraw() external {
        uint256 amt = credit[msg.sender];
        if (amt == 0) revert NothingToWithdraw();
        credit[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amt}("");
        if (!ok) revert TransferFailed();
    }
}
