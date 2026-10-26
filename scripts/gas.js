// Measures on-chain cost (gas) of every trust-layer operation and of the per-reading baselines.
// Run: npx hardhat run scripts/gas.js
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const fs = require("fs");
const M = require("./merkle");

const id = (s) => ethers.id(s);
async function g(txp) { const r = await (await txp).wait(); return Number(r.gasUsed); }
const stats = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); return { mean: m, sd, min: Math.min(...a), max: Math.max(...a), n: a.length }; };

async function main() {
  const out = { ops: {}, deploy: {}, anchorVsBatch: [], disputeVsDepth: [] };
  const [admin, gwA, gwB, prosumer, buyer] = await ethers.getSigners();

  const deployG = async (name, args = []) => {
    const f = await ethers.getContractFactory(name);
    const c = await f.deploy(...args); const r = await c.deploymentTransaction().wait();
    out.deploy[name] = Number(r.gasUsed); return c;
  };
  const reg = await deployG("IoERegistry");
  const ra = await reg.getAddress();
  const acl = await deployG("AccessPolicy", [ra]);
  const anc = await deployG("AnchorRegistry", [ra]);
  const mkt = await deployG("EnergyMarket", [ra]);
  const naive = await deployG("NaiveReadingStore");
  const nlog = await deployG("NaiveReadingLog");

  const N = 30;
  const rec = (k, v) => { (out.ops[k] = out.ops[k] || []).push(v); };

  rec("setGateway", await g(reg.setGateway(gwA.address, true)));
  rec("setGateway", await g(reg.setGateway(gwB.address, true)));

  for (let i = 0; i < N; i++) rec("registerDevice", await g(reg.connect(gwA).registerDevice(id("dev" + i), id("pk" + i), i % 4)));
  for (let i = 0; i < N; i++) rec("rotateKey", await g(reg.connect(gwA).rotateKey(id("dev" + i), id("pk2-" + i))));
  await reg.connect(gwB).registerDevice(id("ems"), id("pk-ems"), 3);

  const exp = (await time.latest()) + 10 ** 7;
  for (let i = 0; i < N; i++) rec("grantPolicy", await g(acl.connect(gwA).grant(id("ems"), id("dev" + i), 5, exp)));
  for (let i = 0; i < N; i++) rec("requestAccess (granted)", await g(acl.connect(gwB).requestAccess(id("ems"), id("dev" + i), 4, i)));
  for (let i = 0; i < N; i++) rec("requestAccess (denied)", await g(acl.connect(gwB).requestAccess(id("ems"), id("dev" + i), 2, 1000 + i)));
  for (let i = 0; i < N; i++) rec("revokePolicy", await g(acl.connect(gwA).revoke(id("ems"), id("dev" + i))));

  // Anchoring: cost vs. batch size (one Merkle root per batch, built from real leaves)
  let seq = 0;
  for (const n of [16, 64, 256, 1024, 4096, 16384, 65536]) {
    const leaves = [...Array(n).keys()].map((i) => ethers.solidityPackedKeccak256(["bytes32", "uint64", "uint64"], [id("dev" + (i % N)), 1700000000 + i, 1000 + i]));
    const t0 = process.hrtime.bigint();
    const layers = M.buildTree(leaves);
    const buildMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const gas = await g(anc.connect(gwA).anchor(++seq, M.root(layers), n, 0, 1));
    rec("anchor", gas);
    out.anchorVsBatch.push({ leaves: n, gas, gasPerReading: gas / n, jsTreeBuildMs: buildMs, depth: layers.length - 1 });
  }
  for (let i = 0; i < N; i++) rec("anchor", await g(anc.connect(gwA).anchor(++seq, id("r" + i), 4096, 0, 1)));

  // Dispute (on-chain inclusion proof) vs. tree depth
  for (const d of [4, 6, 8, 10, 12, 14, 16, 18, 20]) {
    const n = 2 ** d;
    const leaves = [...Array(n).keys()].map((i) => ethers.solidityPackedKeccak256(["uint256", "uint256"], [d, i]));
    const layers = M.buildTree(leaves);
    await anc.connect(gwB).anchor(d === 4 ? 1 : (await anc.lastSeq(gwB.address)) + 1n, M.root(layers), n, 0, 1);
    const s = await anc.lastSeq(gwB.address);
    const idx = Math.floor(n / 3);
    const prf = M.proof(layers, idx);
    const gas = await g(anc.disputeCheck(gwB.address, s, leaves[idx], prf));
    const ok = await anc.verifyInclusion(gwB.address, s, leaves[idx], prf);
    out.disputeVsDepth.push({ depth: d, leaves: n, proofBytes: prf.length * 32, gas, valid: ok });
  }

  // Naive per-reading baselines
  for (let i = 0; i < N; i++) rec("naive store (per reading)", await g(naive.store(id("dev" + (i % 5)), 1700000000 + i * 900, 1000 + i, id("s" + i))));
  for (let i = 0; i < N; i++) rec("naive event log (per reading)", await g(nlog.log(id("dev" + (i % 5)), 1700000000 + i * 900, 1000 + i, id("s" + i))));

  // Market
  const P = 10n ** 9n;
  for (let i = 0; i < N; i++) {
    const dl = (await time.latest()) + 3600;
    rec("createOffer", await g(mkt.connect(prosumer).createOffer(id("dev" + i), 5000n, P, dl)));
    const oid = (await mkt.nextId()) - 1n;
    rec("acceptOffer (escrow)", await g(mkt.connect(buyer).acceptOffer(oid, { value: 5000n * P })));
    rec(i % 2 ? "settle (full)" : "settle (partial+refund)", await g(mkt.connect(gwA).settle(oid, i % 2 ? 5000n : 4200n)));
  }
  rec("withdraw", await g(mkt.connect(prosumer).withdraw()));
  rec("withdraw", await g(mkt.connect(buyer).withdraw()));
  // refund path
  for (let i = 0; i < 5; i++) {
    const dl = (await time.latest()) + 60;
    await mkt.connect(prosumer).createOffer(id("dev" + i), 100n, P, dl);
    const oid = (await mkt.nextId()) - 1n;
    await mkt.connect(buyer).acceptOffer(oid, { value: 100n * P });
    await time.increase(61);
    rec("refundExpired", await g(mkt.connect(buyer).refundExpired(oid)));
  }
  rec("revokeDevice", await g(reg.connect(gwA).revokeDevice(id("dev0"))));

  const summary = {};
  for (const [k, v] of Object.entries(out.ops)) summary[k] = stats(v);
  out.summary = summary;
  out.env = { solc: require("solc").version(), evm: "cancun", optimizer: "enabled, 200 runs", hardhat: require("hardhat/package.json").version, node: process.version };
  fs.mkdirSync("results", { recursive: true });
  fs.writeFileSync("results/gas.json", JSON.stringify(out, null, 2));
  console.table(Object.fromEntries(Object.entries(summary).map(([k, s]) => [k, { mean: Math.round(s.mean), min: s.min, max: s.max, n: s.n }])));
  console.table(out.anchorVsBatch);
  console.table(out.disputeVsDepth);
  console.log(out.deploy);
}
main().catch((e) => { console.error(e); process.exit(1); });
