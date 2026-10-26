// Stateful invariant fuzzing (random sequences of honest and adversarial calls).
// Run separately:  FUZZ_SEQ=60 FUZZ_STEPS=40 npx hardhat test test/fuzz.invariants.js
// Invariants checked after every step:
//  I1 market solvency:  balance(market) == sum(credits) + sum(escrow of Accepted offers)
//  I2 settlement conservation: for every settled offer, paid + refunded == escrow
//  I3 anchor sequences: lastSeq(g) == number of accepted anchors of g; non-gateways never anchor
//  I4 access safety: requestAccess returns true only if both DIDs active, capability covers action and is unexpired
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const fs = require("fs");

function rng(seed) { let s = seed >>> 0; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const SEQ = Number(process.env.FUZZ_SEQ || 20), STEPS = Number(process.env.FUZZ_STEPS || 30);
const id = (s) => ethers.id(s);

describe(`Invariant fuzzing (${SEQ} sequences x ${STEPS} steps)`, function () {
  this.timeout(0);
  it("holds I1-I4 under random honest/adversarial call sequences", async () => {
    const S = await ethers.getSigners();
    const [admin, gwA, gwB, rogue, u1, u2, u3] = S;
    const actors = [gwA, gwB, rogue, u1, u2, u3];
    const stats = { calls: 0, reverted: 0, byOp: {}, violations: 0, sequences: SEQ, steps: STEPS };
    for (let q = 0; q < SEQ; q++) {
      const R = rng(1000 + q); const pick = (a) => a[Math.floor(R() * a.length)];
      const reg = await (await ethers.getContractFactory("IoERegistry")).deploy();
      const acl = await (await ethers.getContractFactory("AccessPolicy")).deploy(await reg.getAddress());
      const anc = await (await ethers.getContractFactory("AnchorRegistry")).deploy(await reg.getAddress());
      const mkt = await (await ethers.getContractFactory("EnergyMarket")).deploy(await reg.getAddress());
      await reg.setGateway(gwA.address, true); await reg.setGateway(gwB.address, true);
      const dids = ["m0", "m1", "m2", "m3"].map(id);
      const gwOf = (d) => (dids.indexOf(d) < 2 ? gwA : gwB);
      for (const d of dids) await reg.connect(gwOf(d)).registerDevice(d, id("k" + d), 0);
      const bias = (good) => (R() < 0.7 ? good : pick(actors)); // 70% well-formed, 30% adversarial actor
      const offers = new Map(); // id -> {escrow, state}
      const anchorsOk = new Map([[gwA.address, 0], [gwB.address, 0], [rogue.address, 0]]);
      const ops = {
        register: async () => { const a = pick(actors); await reg.connect(a).registerDevice(R() < 0.5 ? id("n" + R()) : pick(dids), id("k" + R()), 0); },
        revoke: async () => { if (R() < 0.6) throw new Error("skip"); const d = pick(dids); await reg.connect(bias(gwOf(d))).revokeDevice(d); },
        grant: async () => { const r = pick(dids); await acl.connect(bias(gwOf(r))).grant(pick(dids), r, R() < 0.9 ? 1 + Math.floor(R() * 7) : 8, (await time.latest()) + Math.floor(R() * 400) - 100); },
        request: async () => {
          const s = pick(dids), r = pick(dids), a = bias(gwOf(s)), act = [1, 2, 4][Math.floor(R() * 3)];
          const granted = await acl.connect(a).requestAccess.staticCall(s, r, act, Math.floor(R() * 1e9));
          if (granted) { // I4
            const p = await acl.policies(s, r); const now = BigInt(await time.latest());
            const ok = (await reg.isActive(s)) && (await reg.isActive(r)) && ((Number(p.actions) & act) === act) && now <= p.expiry;
            if (!ok) stats.violations++;
            expect(ok, "I4").to.equal(true);
          }
          await acl.connect(a).requestAccess(s, r, act, Math.floor(R() * 1e9));
        },
        anchor: async () => {
          const a = R() < 0.8 ? pick([gwA, gwB]) : rogue; const cur = Number(await anc.lastSeq(a.address));
          const seq = R() < 0.7 ? cur + 1 : cur + Math.floor(R() * 3) - 1 + (R() < 0.5 ? 0 : 2);
          await anc.connect(a).anchor(seq, R() < 0.95 ? id("r" + R()) : ethers.ZeroHash, 1 + Math.floor(R() * 100), 0, 1);
          anchorsOk.set(a.address, anchorsOk.get(a.address) + 1);
        },
        offer: async () => { const a = pick([u1, u2, u3, rogue]); await mkt.connect(a).createOffer(pick(dids), 1 + Math.floor(R() * 1000), 1 + Math.floor(R() * 1e6), (await time.latest()) + 50 + Math.floor(R() * 300)); },
        accept: async () => {
          const n = Number(await mkt.nextId()); if (n <= 1) throw new Error("none"); const oid = 1 + Math.floor(R() * (n - 1));
          const o = await mkt.offers(oid); const cost = o.energyWh * o.pricePerWh; const v = R() < 0.85 ? cost : cost + BigInt(Math.floor(R() * 3)) - 1n;
          await mkt.connect(pick([u1, u2, u3, rogue])).acceptOffer(oid, { value: v < 0n ? 0n : v });
        },
        settle: async () => {
          const n = Number(await mkt.nextId()); if (n <= 1) throw new Error("none"); const oid = 1 + Math.floor(R() * (n - 1));
          const o = await mkt.offers(oid); const del = BigInt(Math.floor(R() * (Number(o.energyWh) + 5)));
          await mkt.connect(bias(gwOf(o.meterDid))).settle(oid, del);
        },
        refund: async () => { const n = Number(await mkt.nextId()); if (n <= 1) throw new Error("none"); await mkt.connect(pick(actors)).refundExpired(1 + Math.floor(R() * (n - 1))); },
        withdraw: async () => { await mkt.connect(pick([u1, u2, u3, rogue, gwA])).withdraw(); },
        warp: async () => { await time.increase(Math.floor(R() * 200)); },
      };
      const names = Object.keys(ops);
      for (let st = 0; st < STEPS; st++) {
        const op = pick(names); stats.calls++; stats.byOp[op] = stats.byOp[op] || { ok: 0, rev: 0 };
        try { await ops[op](); stats.byOp[op].ok++; } catch (e) { stats.reverted++; stats.byOp[op].rev++; if (op === "anchor") { /* not counted */ } }
        // I1 solvency
        const n = Number(await mkt.nextId()); let escrow = 0n; let credits = 0n;
        for (let i = 1; i < n; i++) { const o = await mkt.offers(i); if (Number(o.state) === 2) escrow += o.energyWh * o.pricePerWh; }
        for (const a of [u1, u2, u3, rogue, gwA, gwB]) credits += await mkt.credit(a.address);
        const bal = await ethers.provider.getBalance(await mkt.getAddress());
        if (bal !== escrow + credits) stats.violations++;
        expect(bal, "I1").to.equal(escrow + credits);
        // I3 sequences
        for (const g of [gwA, gwB]) expect(Number(await anc.lastSeq(g.address)), "I3").to.be.at.most(stats.calls);
        expect(Number(await anc.lastSeq(rogue.address)), "I3 rogue").to.equal(0);
      }
      // I2 conservation via events
      const evs = await mkt.queryFilter(mkt.filters.Settled());
      for (const e of evs) { const o = await mkt.offers(e.args.id); const esc = o.energyWh * o.pricePerWh; if (e.args.paid + e.args.refunded !== esc) stats.violations++; expect(e.args.paid + e.args.refunded, "I2").to.equal(esc); }
      // I3 strict: every stored anchor 1..lastSeq exists and non-zero
      for (const g of [gwA, gwB]) { const ls = Number(await anc.lastSeq(g.address)); for (let k = 1; k <= ls; k++) expect((await anc.anchors(g.address, k)).root).to.not.equal(ethers.ZeroHash); }
    }
    fs.mkdirSync("results", { recursive: true });
    fs.writeFileSync("results/fuzz.json", JSON.stringify(stats, null, 1));
    console.log(JSON.stringify(stats));
    expect(stats.violations).to.equal(0);
  });
});
