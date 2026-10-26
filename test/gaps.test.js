// Tests added after the first mutation analysis to close the gaps exposed by surviving mutants .
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const id = (s) => ethers.id(s);
const Z = ethers.ZeroHash;

async function base() {
  const [admin, gwA, gwB, rogue, prosumer, buyer] = await ethers.getSigners();
  const reg = await (await ethers.getContractFactory("IoERegistry")).deploy();
  const acl = await (await ethers.getContractFactory("AccessPolicy")).deploy(await reg.getAddress());
  const anc = await (await ethers.getContractFactory("AnchorRegistry")).deploy(await reg.getAddress());
  const mkt = await (await ethers.getContractFactory("EnergyMarket")).deploy(await reg.getAddress());
  const mk2 = await (await ethers.getContractFactory("EnergyMarketV2")).deploy(await reg.getAddress());
  await reg.setGateway(gwA.address, true); await reg.setGateway(gwB.address, true);
  await reg.connect(gwA).registerDevice(id("meter-1"), id("pk-1"), 0);
  await reg.connect(gwB).registerDevice(id("ems-1"), id("pk-e"), 3);
  return { admin, gwA, gwB, rogue, prosumer, buyer, reg, acl, anc, mkt, mk2 };
}

describe("Registry input validation and lifecycle", () => {
  it("rejects zero gateway address, zero DID and zero key hash", async () => {
    const c = await base();
    await expect(c.reg.setGateway(ethers.ZeroAddress, true)).to.be.revertedWithCustomError(c.reg, "ZeroValue");
    await expect(c.reg.connect(c.gwA).registerDevice(Z, id("k"), 0)).to.be.revertedWithCustomError(c.reg, "ZeroValue");
    await expect(c.reg.connect(c.gwA).registerDevice(id("x"), Z, 0)).to.be.revertedWithCustomError(c.reg, "ZeroValue");
    await expect(c.reg.connect(c.gwA).rotateKey(id("meter-1"), Z)).to.be.revertedWithCustomError(c.reg, "ZeroValue");
  });
  it("disabling a gateway removes its rights; stores device data correctly", async () => {
    const c = await base();
    expect(await c.reg.isGateway(c.gwA.address)).to.equal(true);
    await c.reg.setGateway(c.gwA.address, false);
    expect(await c.reg.isGateway(c.gwA.address)).to.equal(false);
    await expect(c.reg.connect(c.gwA).registerDevice(id("y"), id("k"), 0)).to.be.revertedWithCustomError(c.reg, "NotGateway");
    expect(await c.reg.gatewayOf(id("meter-1"))).to.equal(c.gwA.address);
    expect(await c.reg.keyHashOf(id("meter-1"))).to.equal(id("pk-1"));
    expect(await c.reg.isActive(id("unknown"))).to.equal(false);
  });
  it("cannot rotate or revoke unknown/revoked devices; only responsible gateway or admin may revoke", async () => {
    const c = await base();
    await expect(c.reg.connect(c.gwA).rotateKey(id("nope"), id("k"))).to.be.revertedWithCustomError(c.reg, "UnknownDevice");
    await expect(c.reg.connect(c.gwB).revokeDevice(id("meter-1"))).to.be.revertedWithCustomError(c.reg, "NotResponsibleGateway");
    await expect(c.reg.connect(c.rogue).revokeDevice(id("meter-1"))).to.be.revertedWithCustomError(c.reg, "NotResponsibleGateway");
    await c.reg.connect(c.admin).revokeDevice(id("meter-1"));            // governance override
    expect(await c.reg.isActive(id("meter-1"))).to.equal(false);
    await expect(c.reg.connect(c.gwA).revokeDevice(id("meter-1"))).to.be.revertedWithCustomError(c.reg, "UnknownDevice");
    await expect(c.reg.connect(c.gwA).rotateKey(id("meter-1"), id("k2"))).to.be.revertedWithCustomError(c.reg, "UnknownDevice");
    await expect(c.reg.connect(c.gwA).revokeDevice(id("nope"))).to.be.revertedWithCustomError(c.reg, "UnknownDevice");
  });
  it("the responsible gateway can revoke its own device", async () => {
    const c = await base();
    await c.reg.connect(c.gwA).revokeDevice(id("meter-1"));
    expect(await c.reg.isActive(id("meter-1"))).to.equal(false);
  });
});

describe("Access policy boundaries", () => {
  it("rejects empty and out-of-range action masks; accepts full mask 7", async () => {
    const c = await base(); const exp = (await time.latest()) + 100;
    await expect(c.acl.connect(c.gwA).grant(id("ems-1"), id("meter-1"), 0, exp)).to.be.revertedWithCustomError(c.acl, "InvalidAction");
    await expect(c.acl.connect(c.gwA).grant(id("ems-1"), id("meter-1"), 8, exp)).to.be.revertedWithCustomError(c.acl, "InvalidAction");
    await c.acl.connect(c.gwA).grant(id("ems-1"), id("meter-1"), 7, exp);
    expect(await c.acl.checkAccess(id("ems-1"), id("meter-1"), 7)).to.equal(true);
    expect(await c.acl.checkAccess(id("ems-1"), id("meter-1"), 0)).to.equal(false);
  });
  it("only the resource's gateway may revoke; revocation removes access", async () => {
    const c = await base(); const exp = (await time.latest()) + 1000;
    await c.acl.connect(c.gwA).grant(id("ems-1"), id("meter-1"), 4, exp);
    await expect(c.acl.connect(c.gwB).revoke(id("ems-1"), id("meter-1"))).to.be.revertedWithCustomError(c.acl, "NotResourceGateway");
    await c.acl.connect(c.gwA).revoke(id("ems-1"), id("meter-1"));
    expect(await c.acl.checkAccess(id("ems-1"), id("meter-1"), 4)).to.equal(false);
  });
  it("capability is valid exactly up to and including its expiry second", async () => {
    const c = await base(); const exp = (await time.latest()) + 50;
    await c.acl.connect(c.gwA).grant(id("ems-1"), id("meter-1"), 4, exp);
    await time.setNextBlockTimestamp(exp);
    await expect(c.acl.connect(c.gwB).requestAccess(id("ems-1"), id("meter-1"), 4, 1)).to.emit(c.acl, "AccessDecision").withArgs(id("ems-1"), id("meter-1"), 4, true, 1);
    await time.setNextBlockTimestamp(exp + 1);
    await expect(c.acl.connect(c.gwB).requestAccess(id("ems-1"), id("meter-1"), 4, 2)).to.emit(c.acl, "AccessDecision").withArgs(id("ems-1"), id("meter-1"), 4, false, 2);
  });
  it("a logged request reports the actual decision; unrelated resource devices are denied", async () => {
    const c = await base(); const exp = (await time.latest()) + 1000;
    await c.acl.connect(c.gwA).grant(id("ems-1"), id("meter-1"), 1, exp);
    await expect(c.acl.connect(c.gwB).requestAccess(id("ems-1"), id("meter-1"), 1, 7)).to.emit(c.acl, "AccessDecision").withArgs(id("ems-1"), id("meter-1"), 1, true, 7);
    expect(await c.acl.usedNonce(id("ems-1"), 7)).to.equal(true);
    await c.reg.connect(c.gwA).revokeDevice(id("meter-1"));   // resource revoked
    expect(await c.acl.checkAccess(id("ems-1"), id("meter-1"), 1)).to.equal(false);
  });
});

describe("Anchor registry and inclusion details", () => {
  it("rejects zero root, empty batch and inverted time window; stores anchor fields", async () => {
    const c = await base();
    await expect(c.anc.connect(c.gwA).anchor(1, Z, 1, 0, 1)).to.be.revertedWithCustomError(c.anc, "BadBatch");
    await expect(c.anc.connect(c.gwA).anchor(1, id("r"), 0, 0, 1)).to.be.revertedWithCustomError(c.anc, "BadBatch");
    await expect(c.anc.connect(c.gwA).anchor(1, id("r"), 1, 5, 4)).to.be.revertedWithCustomError(c.anc, "BadBatch");
    await c.anc.connect(c.gwA).anchor(1, id("r"), 3, 4, 4);
    const a = await c.anc.anchors(c.gwA.address, 1);
    expect(a.root).to.equal(id("r")); expect(a.leafCount).to.equal(3n); expect(a.tStart).to.equal(4n); expect(a.tEnd).to.equal(4n);
    expect(await c.anc.lastSeq(c.gwA.address)).to.equal(1n);
    expect(await c.anc.verifyInclusion(c.gwA.address, 9, Z, [])).to.equal(false);   // empty slot never verifies
  });
  it("single-leaf batches verify with an empty proof; dispute check logs the verdict", async () => {
    const c = await base(); const leaf = id("only");
    await c.anc.connect(c.gwA).anchor(1, leaf, 1, 0, 1);
    expect(await c.anc.verifyInclusion(c.gwA.address, 1, leaf, [])).to.equal(true);
    await expect(c.anc.disputeCheck(c.gwA.address, 1, leaf, [])).to.emit(c.anc, "DisputeChecked").withArgs(c.gwA.address, 1, leaf, true);
    // two-leaf tree: order-independent sorted hashing
    const l2 = id("second"); const [x, y] = BigInt(leaf) < BigInt(l2) ? [leaf, l2] : [l2, leaf];
    const root = ethers.keccak256(ethers.concat([x, y]));
    await c.anc.connect(c.gwA).anchor(2, root, 2, 1, 2);
    expect(await c.anc.verifyInclusion(c.gwA.address, 2, leaf, [l2])).to.equal(true);
    expect(await c.anc.verifyInclusion(c.gwA.address, 2, l2, [leaf])).to.equal(true);
  });
});

describe("Market details (both versions)", () => {
  const P = 10n ** 9n;
  for (const v of ["mkt", "mk2"]) {
    it(`${v}: rejects malformed offers and late acceptance; stores offer fields`, async () => {
      const c = await base(); const m = c[v]; const now = await time.latest();
      await expect(m.connect(c.prosumer).createOffer(id("meter-1"), 0, P, now + 100)).to.be.revertedWithCustomError(m, "BadOffer");
      await expect(m.connect(c.prosumer).createOffer(id("meter-1"), 10, 0, now + 100)).to.be.revertedWithCustomError(m, "BadOffer");
      await expect(m.connect(c.prosumer).createOffer(id("meter-1"), 10, P, now)).to.be.revertedWithCustomError(m, "BadOffer");
      await m.connect(c.prosumer).createOffer(id("meter-1"), 10, P, now + 100);
      const o = await m.offers(1); expect(o.seller).to.equal(c.prosumer.address); expect(o.energyWh).to.equal(10n); expect(o.state).to.equal(1n);
      expect(await m.nextId()).to.equal(2n);
      await time.increaseTo(now + 101);
      await expect(m.connect(c.buyer).acceptOffer(1, { value: 10n * P })).to.be.revertedWithCustomError(m, "BadState");
      await expect(m.connect(c.buyer).acceptOffer(9, { value: 0 })).to.be.revertedWithCustomError(m, "BadState");
    });
    it(`${v}: accepted offer records buyer and state; cannot be accepted twice; withdraw pays out and empties credit`, async () => {
      const c = await base(); const m = c[v]; const now = await time.latest();
      await m.connect(c.prosumer).createOffer(id("meter-1"), 10, P, now + 100);
      await m.connect(c.buyer).acceptOffer(1, { value: 10n * P });
      const o = await m.offers(1); expect(o.buyer).to.equal(c.buyer.address); expect(o.state).to.equal(2n);
      await expect(m.connect(c.rogue).acceptOffer(1, { value: 10n * P })).to.be.revertedWithCustomError(m, "BadState");
      await expect(m.connect(c.buyer).withdraw()).to.be.revertedWithCustomError(m, "NothingToWithdraw");
      await time.increaseTo(now + 101);
      await m.connect(c.buyer).refundExpired(1);
      expect((await m.offers(1)).state).to.equal(4n);
      await expect(m.connect(c.buyer).refundExpired(1)).to.be.revertedWithCustomError(m, "BadState");
      await expect(() => m.connect(c.buyer).withdraw()).to.changeEtherBalance(c.buyer, 10n * P);
      expect(await m.credit(c.buyer.address)).to.equal(0n);
    });
    it(`${v}: refund exactly at the deadline is too early`, async () => {
      const c = await base(); const m = c[v]; const now = await time.latest();
      await m.connect(c.prosumer).createOffer(id("meter-1"), 10, P, now + 100);
      await m.connect(c.buyer).acceptOffer(1, { value: 10n * P });
      await time.setNextBlockTimestamp(now + 100);
      await expect(m.connect(c.buyer).refundExpired(1)).to.be.revertedWithCustomError(m, "TooEarly");
    });
  }
  it("mkt: full delivery leaves no refund credit and sets state Settled; settlement of unaccepted offer refused", async () => {
    const c = await base(); const now = await time.latest();
    await c.mkt.connect(c.prosumer).createOffer(id("meter-1"), 10, P, now + 100);
    await expect(c.mkt.connect(c.gwA).settle(1, 10)).to.be.revertedWithCustomError(c.mkt, "BadState");
    await c.mkt.connect(c.buyer).acceptOffer(1, { value: 10n * P });
    await c.mkt.connect(c.gwA).settle(1, 10);
    expect((await c.mkt.offers(1)).state).to.equal(3n);
    expect(await c.mkt.credit(c.buyer.address)).to.equal(0n);
    expect(await c.mkt.credit(c.prosumer.address)).to.equal(10n * P);
  });
  it("mk2: attested settlement updates state and refuses over-delivery and unaccepted offers", async () => {
    const c = await base(); const meter = ethers.Wallet.createRandom();
    await c.reg.connect(c.gwA).registerDevice(id("meter-2"), ethers.solidityPackedKeccak256(["address"], [meter.address]), 0);
    const now = await time.latest();
    await c.mk2.connect(c.prosumer).createOffer(id("meter-2"), 10, P, now + 100);
    const sig = async (oid, wh) => ethers.Signature.from(await meter.signMessage(ethers.getBytes(await c.mk2.attestationDigest(oid, id("meter-2"), wh))));
    let s = await sig(1, 10);
    await expect(c.mk2.settleAttested(1, 10, s.v, s.r, s.s)).to.be.revertedWithCustomError(c.mk2, "BadState");
    await c.mk2.connect(c.buyer).acceptOffer(1, { value: 10n * P });
    s = await sig(1, 11);
    await expect(c.mk2.settleAttested(1, 11, s.v, s.r, s.s)).to.be.revertedWithCustomError(c.mk2, "OverDelivery");
    s = await sig(1, 10);
    await expect(c.mk2.settleAttested(1, 10, s.v, s.r, "0x" + "00".repeat(32))).to.be.revertedWithCustomError(c.mk2, "BadAttestation");
    await c.mk2.connect(c.relayerOrRogue || c.rogue).settleAttested(1, 10, s.v, s.r, s.s);
    expect((await c.mk2.offers(1)).state).to.equal(3n);
    expect(await c.mk2.credit(c.buyer.address)).to.equal(0n);
    expect(await c.mk2.credit(c.prosumer.address)).to.equal(10n * P);
  });
});

describe("Boundary and failure-path tests added after the second mutation pass", () => {
  const P = 10n ** 9n;
  for (const v of ["mkt", "mk2"]) {
    it(`${v}: an offer whose deadline equals the current block time is refused`, async () => {
      const c = await base(); const m = c[v]; const t = (await time.latest()) + 10;
      await time.setNextBlockTimestamp(t);
      await expect(m.connect(c.prosumer).createOffer(id("meter-1"), 10, P, t)).to.be.revertedWithCustomError(m, "BadOffer");
    });
    it(`${v}: acceptance exactly at the deadline is still allowed`, async () => {
      const c = await base(); const m = c[v]; const t = (await time.latest()) + 100;
      await m.connect(c.prosumer).createOffer(id("meter-1"), 10, P, t);
      await time.setNextBlockTimestamp(t);
      await m.connect(c.buyer).acceptOffer(1, { value: 10n * P });
      expect((await m.offers(1)).state).to.equal(2n);
    });
    it(`${v}: offers on unregistered meters and wrong escrow are refused`, async () => {
      const c = await base(); const m = c[v]; const t = (await time.latest()) + 100;
      await expect(m.connect(c.prosumer).createOffer(id("ghost"), 10, P, t)).to.be.revertedWithCustomError(m, "InactiveMeter");
      await m.connect(c.prosumer).createOffer(id("meter-1"), 10, P, t);
      await expect(m.connect(c.buyer).acceptOffer(1, { value: 10n * P + 1n })).to.be.revertedWithCustomError(m, "WrongPayment");
    });
    it(`${v}: a payout to a recipient that rejects ETH reverts and keeps the credit`, async () => {
      const c = await base(); const m = c[v]; const t = (await time.latest()) + 100;
      const rr = await (await ethers.getContractFactory("RejectingReceiver")).deploy(await m.getAddress());
      await rr.offer(id("meter-1"), 10, P, t);
      await m.connect(c.buyer).acceptOffer(1, { value: 10n * P });
      await time.increaseTo(t + 1);
      await m.connect(c.buyer).refundExpired(1);                 // buyer credit; now make the seller side fail:
      // seller credit only arises on settlement; use refund path for buyer and settlement path for rr
      await rr.offer(id("meter-1"), 5, P, (await time.latest()) + 100);
      await m.connect(c.buyer).acceptOffer(2, { value: 5n * P });
      if (v === "mkt") await m.connect(c.gwA).settle(2, 5);
      else {
        const meter = ethers.Wallet.createRandom();
        // re-key meter-1 to a known signing key so the attestation verifies
        await c.reg.connect(c.gwA).rotateKey(id("meter-1"), ethers.solidityPackedKeccak256(["address"], [meter.address]));
        const sg = ethers.Signature.from(await meter.signMessage(ethers.getBytes(await m.attestationDigest(2, id("meter-1"), 5))));
        await m.settleAttested(2, 5, sg.v, sg.r, sg.s);
      }
      await expect(rr.pull()).to.be.revertedWithCustomError(m, "TransferFailed");
      expect(await m.credit(await rr.getAddress())).to.equal(5n * P);
    });
  }
});
