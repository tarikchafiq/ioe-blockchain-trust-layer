// A21-A24: meter-signed delivery attestation (EnergyMarketV2) - removes the trusted-gateway oracle assumption.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const id = (s) => ethers.id(s);
const P = 10n ** 9n;

async function setup() {
  const [admin, gw, prosumer, buyer, relayer] = await ethers.getSigners();
  const meter = ethers.Wallet.createRandom();      // key inside the meter's secure element
  const rogue = ethers.Wallet.createRandom();      // attacker-controlled key
  const reg = await (await ethers.getContractFactory("IoERegistry")).deploy();
  const mkt = await (await ethers.getContractFactory("EnergyMarketV2")).deploy(await reg.getAddress());
  await reg.setGateway(gw.address, true);
  await reg.connect(gw).registerDevice(id("meter-1"), ethers.solidityPackedKeccak256(["address"], [meter.address]), 0);
  const dl = (await time.latest()) + 3600;
  await mkt.connect(prosumer).createOffer(id("meter-1"), 5000n, P, dl);
  await mkt.connect(buyer).acceptOffer(1n, { value: 5000n * P });
  const sign = async (w, oid, wh, market = mkt) => {
    const dig = await market.attestationDigest(oid, id("meter-1"), wh);
    return ethers.Signature.from(await w.signMessage(ethers.getBytes(dig)));
  };
  return { admin, gw, prosumer, buyer, relayer, meter, rogue, reg, mkt, sign };
}

describe("Meter-attested settlement (EnergyMarketV2)", () => {
  it("settles with a valid meter attestation relayed by any party", async () => {
    const c = await setup(); const s = await c.sign(c.meter, 1n, 4200n);
    await c.mkt.connect(c.relayer).settleAttested(1n, 4200n, s.v, s.r, s.s);
    expect(await c.mkt.credit(c.prosumer.address)).to.equal(4200n * P);
    expect(await c.mkt.credit(c.buyer.address)).to.equal(800n * P);
  });
  it("A21 a compromised gateway (or anyone) cannot forge a delivery attestation", async () => {
    const c = await setup(); const s = await c.sign(c.rogue, 1n, 5000n);
    await expect(c.mkt.connect(c.gw).settleAttested(1n, 5000n, s.v, s.r, s.s)).to.be.revertedWithCustomError(c.mkt, "BadAttestation");
  });
  it("A22 a genuine attestation cannot be altered (delivered energy inflated)", async () => {
    const c = await setup(); const s = await c.sign(c.meter, 1n, 3000n);
    await expect(c.mkt.settleAttested(1n, 4999n, s.v, s.r, s.s)).to.be.revertedWithCustomError(c.mkt, "BadAttestation");
  });
  it("A23 an attestation cannot be replayed on another offer or another market", async () => {
    const c = await setup();
    const dl = (await time.latest()) + 3600;
    await c.mkt.connect(c.prosumer).createOffer(id("meter-1"), 5000n, P, dl);
    await c.mkt.connect(c.buyer).acceptOffer(2n, { value: 5000n * P });
    const s1 = await c.sign(c.meter, 1n, 5000n);
    await c.mkt.settleAttested(1n, 5000n, s1.v, s1.r, s1.s);
    await expect(c.mkt.settleAttested(2n, 5000n, s1.v, s1.r, s1.s)).to.be.revertedWithCustomError(c.mkt, "BadAttestation");
    const mkt2 = await (await ethers.getContractFactory("EnergyMarketV2")).deploy(await c.reg.getAddress());
    await mkt2.connect(c.prosumer).createOffer(id("meter-1"), 5000n, P, dl);
    await mkt2.connect(c.buyer).acceptOffer(1n, { value: 5000n * P });
    await expect(mkt2.settleAttested(1n, 5000n, s1.v, s1.r, s1.s)).to.be.revertedWithCustomError(mkt2, "BadAttestation");
  });
  it("A24 attestations from a revoked meter key are refused, and malleable signatures are rejected", async () => {
    const c = await setup(); const s = await c.sign(c.meter, 1n, 5000n);
    // malleated twin (s' = n - s, v flipped) recovers the same signer: must be rejected
    const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
    const sPrime = ethers.toBeHex(N - BigInt(s.s), 32);
    await expect(c.mkt.settleAttested(1n, 5000n, s.v === 27 ? 28 : 27, s.r, sPrime)).to.be.revertedWithCustomError(c.mkt, "BadAttestation");
    await c.reg.connect(c.gw).revokeDevice(id("meter-1"));
    await expect(c.mkt.settleAttested(1n, 5000n, s.v, s.r, s.s)).to.be.revertedWithCustomError(c.mkt, "InactiveMeter");
  });
});
