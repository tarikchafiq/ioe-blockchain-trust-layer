// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IoERegistry.sol";

/// @title EnergyMarket - escrowed peer-to-peer energy trading with gateway-attested settlement
/// @notice Funds are escrowed at acceptance and released pro rata to the energy actually
///         delivered, as attested by the seller meter's gateway. Pull-payment pattern
///         (withdraw) and checks-effects-interactions prevent re-entrancy.
contract EnergyMarket {
    IoERegistry public immutable registry;

    enum State { None, Open, Accepted, Settled, Refunded }

    struct Offer {
        address seller;
        address buyer;
        bytes32 meterDid;      // seller's meter identity (registered device)
        uint64  energyWh;
        uint128 pricePerWh;    // in wei
        uint64  deadline;      // end of delivery window
        State   state;
    }

    uint256 public nextId = 1;
    mapping(uint256 => Offer) public offers;
    mapping(address => uint256) public credit;

    event OfferCreated(uint256 indexed id, address indexed seller, bytes32 meterDid, uint64 energyWh, uint128 pricePerWh, uint64 deadline);
    event OfferAccepted(uint256 indexed id, address indexed buyer, uint256 escrow);
    event Settled(uint256 indexed id, uint64 deliveredWh, uint256 paid, uint256 refunded);
    event Refunded(uint256 indexed id, uint256 amount);

    error InactiveMeter();
    error BadOffer();
    error BadState();
    error WrongPayment();
    error NotOracle();
    error OverDelivery();
    error TooEarly();
    error NothingToWithdraw();
    error TransferFailed();

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
        o.buyer = msg.sender;
        o.state = State.Accepted;
        emit OfferAccepted(id, msg.sender, cost);
    }

    /// @notice Called by the gateway responsible for the seller's meter (settlement oracle).
    function settle(uint256 id, uint64 deliveredWh) external {
        Offer storage o = offers[id];
        if (o.state != State.Accepted) revert BadState();
        if (registry.gatewayOf(o.meterDid) != msg.sender) revert NotOracle();
        if (deliveredWh > o.energyWh) revert OverDelivery();
        o.state = State.Settled;
        uint256 paid = uint256(deliveredWh) * o.pricePerWh;
        uint256 refund = uint256(o.energyWh - deliveredWh) * o.pricePerWh;
        credit[o.seller] += paid;
        if (refund > 0) credit[o.buyer] += refund;
        emit Settled(id, deliveredWh, paid, refund);
    }

    /// @notice Buyer protection: if no attestation arrives before the deadline, escrow is returned.
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
        credit[msg.sender] = 0;                         // effects before interaction
        (bool ok, ) = payable(msg.sender).call{value: amt}("");
        if (!ok) revert TransferFailed();
    }
}
