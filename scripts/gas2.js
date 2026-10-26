// Gas of the stronger baselines and of meter-attested settlement. Output: results/gas2.json
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const fs = require("fs");
const id = (s) => ethers.id(s);
const g = async (p) => Number((await (await p).wait()).gasUsed);

async function main() {
  const out = { batchHashLog: [], deviceHashChains: [], attested: {} };
  const [admin, gw, prosumer, buyer] = await ethers.getSigners();
  // Baseline A: all leaf hashes of a batch in one tx (event)
  const bl = await (await ethers.getContractFactory("BatchHashLog")).deploy();
  let seq = 0;
  await bl.publish(++seq, [id("warm")]); // initialise lastSeq slot
  for (const n of [16, 64, 256, 333, 1024, 4096]) {
    const leaves = [...Array(n).keys()].map((i) => id("l" + n + "-" + i));
    const gas = await g(bl.publish(++seq, leaves, { gasLimit: 29_000_000 }));
    out.batchHashLog.push({ leaves: n, gas, gasPerReading: gas / n });
  }
  // Baseline B: per-device hash chains, one gateway tx per period updating k heads
  const dh = await (await ethers.getContractFactory("DeviceHashChains")).deploy();
  for (const k of [10, 50, 100, 200, 400]) {
    const dids = [...Array(k).keys()].map((i) => id("dev" + k + "-" + i));
    const hs = dids.map((d) => id("h" + d)); const ns = dids.map(() => 1);
    const cold = await g(dh.update(dids, hs, ns, { gasLimit: 29_000_000 }));
    const warm = await g(dh.update(dids, hs.map((h) => id(h)), ns, { gasLimit: 29_000_000 }));
    out.deviceHashChains.push({ k, gasFirst: cold, gasSteady: warm, steadyPerDevice: warm / k });
  }
  // Meter-attested settlement
  const reg = await (await ethers.getContractFactory("IoERegistry")).deploy();
  const m2 = await (await ethers.getContractFactory("EnergyMarketV2")).deploy(await reg.getAddress());
  out.attested.deploy = Number((await m2.deploymentTransaction().wait()).gasUsed);
  await reg.setGateway(gw.address, true);
  const meter = ethers.Wallet.createRandom();
  await reg.connect(gw).registerDevice(id("meter"), ethers.solidityPackedKeccak256(["address"], [meter.address]), 0);
  const P = 10n ** 9n; const settle = [];
  for (let i = 1; i <= 20; i++) {
    await m2.connect(prosumer).createOffer(id("meter"), 5000n, P, (await time.latest()) + 3600);
    await m2.connect(buyer).acceptOffer(i, { value: 5000n * P });
    const wh = i % 2 ? 5000n : 4200n;
    const sig = ethers.Signature.from(await meter.signMessage(ethers.getBytes(await m2.attestationDigest(i, id("meter"), wh))));
    settle.push({ partial: wh !== 5000n, gas: await g(m2.settleAttested(i, wh, sig.v, sig.r, sig.s)) });
  }
  const full = settle.filter((s) => !s.partial).map((s) => s.gas), part = settle.filter((s) => s.partial).map((s) => s.gas);
  out.attested.settleAttested_full = { min: Math.min(...full), max: Math.max(...full), n: full.length };
  out.attested.settleAttested_partial = { min: Math.min(...part), max: Math.max(...part), n: part.length };
  fs.writeFileSync("results/gas2.json", JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
