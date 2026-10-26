// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NaiveReadingStore - baseline: every meter reading written on-chain individually
contract NaiveReadingStore {
    struct Reading { uint64 ts; uint64 valueWh; bytes32 sigHash; }
    mapping(bytes32 => mapping(uint64 => Reading)) public readings; // did => ts => reading
    event ReadingStored(bytes32 indexed did, uint64 ts, uint64 valueWh);

    function store(bytes32 did, uint64 ts, uint64 valueWh, bytes32 sigHash) external {
        readings[did][ts] = Reading(ts, valueWh, sigHash);
        emit ReadingStored(did, ts, valueWh);
    }
}

/// @title NaiveReadingLog - cheaper baseline: readings emitted as events only (no storage)
contract NaiveReadingLog {
    event Reading(bytes32 indexed did, uint64 ts, uint64 valueWh, bytes32 sigHash);
    function log(bytes32 did, uint64 ts, uint64 valueWh, bytes32 sigHash) external {
        emit Reading(did, ts, valueWh, sigHash);
    }
}

/// @title Attacker - re-entrancy probe against EnergyMarket.withdraw()
interface IMarket { function withdraw() external; function createOffer(bytes32,uint64,uint128,uint64) external returns (uint256); }
contract ReentrancyAttacker {
    IMarket public m; uint256 public reentered;
    constructor(IMarket _m) { m = _m; }
    function offer(bytes32 did, uint64 e, uint128 p, uint64 d) external returns (uint256) { return m.createOffer(did, e, p, d); }
    function attack() external { m.withdraw(); }
    receive() external payable {
        if (reentered < 3) { reentered++; try m.withdraw() { } catch { } }
    }
}

/// @title VulnerableBank - control case: interaction-before-effect withdraw (used only to validate the probe)
contract VulnerableBank {
    mapping(address => uint256) public credit;
    function deposit() external payable { credit[msg.sender] += msg.value; }
    function withdraw() external {
        uint256 amt = credit[msg.sender];
        require(amt > 0, "none");
        (bool ok, ) = payable(msg.sender).call{value: amt}("");
        require(ok, "fail");
        credit[msg.sender] = 0;
    }
}
contract BankAttacker {
    VulnerableBank public b; uint256 public n;
    constructor(VulnerableBank _b) { b = _b; }
    function go() external payable { b.deposit{value: msg.value}(); b.withdraw(); }
    receive() external payable { if (n < 3) { n++; b.withdraw(); } }
}

/// @title RejectingReceiver - seller account that refuses ETH (used to test TransferFailed handling)
interface IMarketR { function withdraw() external; function createOffer(bytes32,uint64,uint128,uint64) external returns (uint256); }
contract RejectingReceiver {
    IMarketR public m;
    constructor(IMarketR _m) { m = _m; }
    function offer(bytes32 did, uint64 e, uint128 p, uint64 d) external returns (uint256) { return m.createOffer(did, e, p, d); }
    function pull() external { m.withdraw(); }
    receive() external payable { revert("no ETH"); }
}
