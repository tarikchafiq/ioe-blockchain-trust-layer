// Functional and adversarial test-suite for the IoE blockchain trust layer.
// Each "A#" test corresponds to a threat in the paper's threat model (Table: threat-to-control mapping).
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const M = require("../scripts/merkle");

const id = (s) => ethers.id(s);
const READ = 1, WRITE = 2, CONTROL = 4;

async function deploy() {
  const [admin, gwA, gwB, rogue, prosumer, buyer] = await ethers.getSigners();
  const reg = await (await ethers.getContractFactory("IoERegistry")).deploy();
  const acl = await (await ethers.getContractFactory("AccessPolicy")).deploy(await reg.getAddress());
  const anc = await (await ethers.getContractFactory("AnchorRegistry")).deploy(await reg.getAddress());
  const mkt = await (await ethers.getContractFactory("EnergyMarket")).deploy(await reg.getAddress());
  await reg.setGateway(gwA.address, true);
  await reg.setGateway(gwB.address, true);
  await reg.connect(gwA).registerDevice(id("meter-1"), id("pk-meter-1"), 0);
  await reg.connect(gwA).registerDevice(id("inverter-1"), id("pk-inv-1"), 1);
  await reg.connect(gwB).registerDevice(id("ems-1"), id("pk-ems-1"), 3);
  return { admin, gwA, gwB, rogue, prosumer, buyer, reg, acl, anc, mkt };
}

describe("Identity layer (IoERegistry)", () => {
  it("A1 rejects device registration by a non-authorised gateway (rogue node / Sybil)", async () => {
    const { reg, rogue } = await deploy();
    await expect(reg.connect(rogue).registerDevice(id("fake"), id("pk"), 0)).to.be.revertedWithCustomError(reg, "NotGateway");
  });
  it("A2 rejects duplicate identifiers (identity hijacking)", async () => {
    const { reg, gwB } = await deploy();
    await expect(reg.connect(gwB).registerDevice(id("meter-1"), id("pk-x"), 0)).to.be.revertedWithCustomError(reg, "AlreadyRegistered");
  });
  it("A3 only the responsible gateway may rotate a device key", async () => {
    const { reg, gwB, gwA } = await deploy();
    await expect(reg.connect(gwB).rotateKey(id("meter-1"), id("pk-new"))).to.be.revertedWithCustomError(reg, "NotResponsibleGateway");
    await reg.connect(gwA).rotateKey(id("meter-1"), id("pk-new"));
    expect(await reg.keyHashOf(id("meter-1"))).to.equal(id("pk-new"));
  });
  it("A4 a non-admin cannot enrol gateways (privilege escalation)", async () => {
    const { reg, rogue } = await deploy();
    await expect(reg.connect(rogue).setGateway(rogue.address, true)).to.be.revertedWithCustomError(reg, "NotAdmin");
  });
});

describe("Access-control layer (AccessPolicy)", () => {
  it("grants a valid, unexpired capability", async () => {
    const { acl, gwA } = await deploy();
    const exp = (await time.latest()) + 3600;
    await acl.connect(gwA).grant(id("ems-1"), id("inverter-1"), READ | CONTROL, exp);
    expect(await acl.checkAccess(id("ems-1"), id("inverter-1"), CONTROL)).to.equal(true);
    expect(await acl.checkAccess(id("ems-1"), id("inverter-1"), WRITE)).to.equal(false);
  });
  it("A5 only the resource's gateway may grant a policy", async () => {
    const { acl, gwB } = await deploy();
    await expect(acl.connect(gwB).grant(id("ems-1"), id("inverter-1"), READ, 9e9)).to.be.revertedWithCustomError(acl, "NotResourceGateway");
  });
  it("A6 expired capabilities are denied", async () => {
    const { acl, gwA } = await deploy();
    const exp = (await time.latest()) + 60;
    await acl.connect(gwA).grant(id("ems-1"), id("inverter-1"), CONTROL, exp);
    await time.increase(120);
    expect(await acl.checkAccess(id("ems-1"), id("inverter-1"), CONTROL)).to.equal(false);
  });
  it("A7 replayed access requests are rejected (nonce)", async () => {
    const { acl, gwA, gwB } = await deploy();
    await acl.connect(gwA).grant(id("ems-1"), id("inverter-1"), CONTROL, (await time.latest()) + 3600);
    await acl.connect(gwB).requestAccess(id("ems-1"), id("inverter-1"), CONTROL, 42);
    await expect(acl.connect(gwB).requestAccess(id("ems-1"), id("inverter-1"), CONTROL, 42)).to.be.revertedWithCustomError(acl, "ReplayedNonce");
  });
  it("A8 revoked (compromised) devices lose all access immediately", async () => {
    const { acl, reg, gwA, gwB } = await deploy();
    await acl.connect(gwA).grant(id("ems-1"), id("inverter-1"), CONTROL, (await time.latest()) + 3600);
    await reg.connect(gwB).revokeDevice(id("ems-1"));
    expect(await acl.checkAccess(id("ems-1"), id("inverter-1"), CONTROL)).to.equal(false);
  });
  it("A9 a gateway cannot submit requests on behalf of devices it does not manage (impersonation)", async () => {
    const { acl, gwA } = await deploy();
    await expect(acl.connect(gwA).requestAccess(id("ems-1"), id("inverter-1"), READ, 1)).to.be.revertedWithCustomError(acl, "NotSubjectGateway");
  });
});

describe("Data-provenance layer (AnchorRegistry)", () => {
  async function batch(n) {
    const leaves = [...Array(n).keys()].map((i) => ethers.solidityPackedKeccak256(["bytes32", "uint64", "uint64"], [id("meter-1"), 1700000000 + i * 900, 1000 + i]));
    const layers = M.buildTree(leaves);
    return { leaves, layers, root: M.root(layers) };
  }
  it("verifies inclusion of an authentic reading", async () => {
    const { anc, gwA } = await deploy();
    const b = await batch(1024);
    await anc.connect(gwA).anchor(1, b.root, 1024, 0, 1);
    expect(await anc.verifyInclusion(gwA.address, 1, b.leaves[777], M.proof(b.layers, 777))).to.equal(true);
  });
  it("A10 detects a falsified reading (false-data injection after anchoring)", async () => {
    const { anc, gwA } = await deploy();
    const b = await batch(1024);
    await anc.connect(gwA).anchor(1, b.root, 1024, 0, 1);
    const forged = ethers.solidityPackedKeccak256(["bytes32", "uint64", "uint64"], [id("meter-1"), 1700000000 + 777 * 900, 1]);
    expect(await anc.verifyInclusion(gwA.address, 1, forged, M.proof(b.layers, 777))).to.equal(false);
  });
  it("A11 rejects a valid proof replayed against the wrong batch", async () => {
    const { anc, gwA } = await deploy();
    const b1 = await batch(64), b2 = await batch(128);
    await anc.connect(gwA).anchor(1, b1.root, 64, 0, 1);
    await anc.connect(gwA).anchor(2, b2.root, 128, 1, 2);
    expect(await anc.verifyInclusion(gwA.address, 2, b1.leaves[5], M.proof(b1.layers, 5))).to.equal(false);
  });
  it("A12 rejects replayed / out-of-order / skipped anchors (omission & replay)", async () => {
    const { anc, gwA } = await deploy();
    const b = await batch(64);
    await anc.connect(gwA).anchor(1, b.root, 64, 0, 1);
    await expect(anc.connect(gwA).anchor(1, b.root, 64, 0, 1)).to.be.revertedWithCustomError(anc, "BadSequence");
    await expect(anc.connect(gwA).anchor(3, b.root, 64, 0, 1)).to.be.revertedWithCustomError(anc, "BadSequence");
  });
  it("A13 rejects anchors from non-gateway accounts", async () => {
    const { anc, rogue } = await deploy();
    await expect(anc.connect(rogue).anchor(1, id("x"), 1, 0, 1)).to.be.revertedWithCustomError(anc, "NotGateway");
  });
});

describe("P2P market layer (EnergyMarket)", () => {
  const P = 10n ** 9n; // wei per Wh
  async function open(ctx, wh = 5000n) {
    const dl = (await time.latest()) + 3600;
    await ctx.mkt.connect(ctx.prosumer).createOffer(id("meter-1"), wh, P, dl);
    return { oid: 1n, cost: wh * P, dl };
  }
  it("settles pro rata to attested delivery and refunds the remainder", async () => {
    const c = await deploy(); const { oid, cost } = await open(c);
    await c.mkt.connect(c.buyer).acceptOffer(oid, { value: cost });
    await c.mkt.connect(c.gwA).settle(oid, 4000n);
    expect(await c.mkt.credit(c.prosumer.address)).to.equal(4000n * P);
    expect(await c.mkt.credit(c.buyer.address)).to.equal(1000n * P);
  });
  it("A14 offers backed by unregistered/revoked meters are refused", async () => {
    const c = await deploy();
    await expect(c.mkt.connect(c.prosumer).createOffer(id("ghost"), 10, P, (await time.latest()) + 60)).to.be.revertedWithCustomError(c.mkt, "InactiveMeter");
  });
  it("A15 wrong escrow amounts are refused", async () => {
    const c = await deploy(); const { oid, cost } = await open(c);
    await expect(c.mkt.connect(c.buyer).acceptOffer(oid, { value: cost - 1n })).to.be.revertedWithCustomError(c.mkt, "WrongPayment");
  });
  it("A16 only the meter's gateway can attest delivery (oracle spoofing)", async () => {
    const c = await deploy(); const { oid, cost } = await open(c);
    await c.mkt.connect(c.buyer).acceptOffer(oid, { value: cost });
    await expect(c.mkt.connect(c.gwB).settle(oid, 5000)).to.be.revertedWithCustomError(c.mkt, "NotOracle");
    await expect(c.mkt.connect(c.prosumer).settle(oid, 5000)).to.be.revertedWithCustomError(c.mkt, "NotOracle");
  });
  it("A17 over-reporting of delivered energy is refused", async () => {
    const c = await deploy(); const { oid, cost } = await open(c);
    await c.mkt.connect(c.buyer).acceptOffer(oid, { value: cost });
    await expect(c.mkt.connect(c.gwA).settle(oid, 5001)).to.be.revertedWithCustomError(c.mkt, "OverDelivery");
  });
  it("A18 double settlement is refused", async () => {
    const c = await deploy(); const { oid, cost } = await open(c);
    await c.mkt.connect(c.buyer).acceptOffer(oid, { value: cost });
    await c.mkt.connect(c.gwA).settle(oid, 5000);
    await expect(c.mkt.connect(c.gwA).settle(oid, 5000)).to.be.revertedWithCustomError(c.mkt, "BadState");
  });
  it("A19 escrow cannot be reclaimed before the delivery deadline, but can after it", async () => {
    const c = await deploy(); const { oid, cost } = await open(c);
    await c.mkt.connect(c.buyer).acceptOffer(oid, { value: cost });
    await expect(c.mkt.connect(c.buyer).refundExpired(oid)).to.be.revertedWithCustomError(c.mkt, "TooEarly");
    await time.increase(3601);
    await c.mkt.connect(c.buyer).refundExpired(oid);
    expect(await c.mkt.credit(c.buyer.address)).to.equal(cost);
  });
  it("A20 re-entrancy on withdraw() cannot drain the contract", async () => {
    const c = await deploy();
    const att = await (await ethers.getContractFactory("ReentrancyAttacker")).deploy(await c.mkt.getAddress());
    const dl = (await time.latest()) + 3600;
    await att.offer(id("meter-1"), 1000n, P, dl);                       // attacker is the seller
    await c.mkt.connect(c.prosumer).createOffer(id("meter-1"), 9000n, P, dl); // honest offer funds the pool
    await c.mkt.connect(c.buyer).acceptOffer(1n, { value: 1000n * P });
    await c.mkt.connect(c.buyer).acceptOffer(2n, { value: 9000n * P });
    await c.mkt.connect(c.gwA).settle(1n, 1000n);
    await c.mkt.connect(c.gwA).settle(2n, 9000n);
    const before = await ethers.provider.getBalance(await c.mkt.getAddress());
    await att.attack();
    const after = await ethers.provider.getBalance(await c.mkt.getAddress());
    expect(before - after).to.equal(1000n * P);                       // exactly its own credit
    expect(await ethers.provider.getBalance(await att.getAddress())).to.equal(1000n * P);
    expect(await c.mkt.credit(c.prosumer.address)).to.equal(9000n * P);
  });
});
