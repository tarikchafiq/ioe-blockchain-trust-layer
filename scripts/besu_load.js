// Load test on a multi-node Besu QBFT network.
// Usage: node scripts/besu_load.js <label> <mode:log|store|anchor> <rateTxPerSec> <durationSec> [rpcPorts=8545,8546,8547,8548]
// Measures achieved throughput and submit->inclusion latency (block observed by a poller).
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const [label, mode, rateS, durS, portsS] = process.argv.slice(2);
const RATE = Number(rateS), DUR = Number(durS);
const PORTS = (portsS || "8545,8546,8547,8548").split(",").map(Number);
const accounts = JSON.parse(fs.readFileSync("/home/claude/work/besu/accounts.json"));
const deployed = JSON.parse(fs.readFileSync("/home/claude/work/besu/deployed.json"));
const art = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts/contracts", n.file, n.name + ".json")));
const providers = PORTS.map((p) => new ethers.JsonRpcProvider("http://127.0.0.1:" + p, 1337, { staticNetwork: true, batchMaxCount: 1 }));

const ifaceLog = new ethers.Interface(art({ file: "Baseline.sol", name: "NaiveReadingLog" }).abi);
const ifaceStore = new ethers.Interface(art({ file: "Baseline.sol", name: "NaiveReadingStore" }).abi);
const ifaceAnc = new ethers.Interface(art({ file: "AnchorRegistry.sol", name: "AnchorRegistry" }).abi);
const GASLIM = { log: 27000, store: 72000, anchor: 100000 };

async function main() {
  const senders = accounts.slice(4, 24).map((a) => new ethers.Wallet(a.k)); // 20 senders (all enrolled as gateways)
  const p0 = providers[0];
  const nonces = await Promise.all(senders.map((w) => p0.getTransactionCount(w.address, "pending")));
  const seqs = mode === "anchor" ? await Promise.all(senders.map(async (w) => Number(await new ethers.Contract(deployed.AnchorRegistry, ifaceAnc, p0).lastSeq(w.address)))) : null;
  const total = Math.round(RATE * DUR);
  // pre-sign
  const txs = [];
  for (let i = 0; i < total; i++) {
    const s = i % senders.length; const w = senders[s];
    let to, data;
    if (mode === "log") { to = deployed.NaiveReadingLog; data = ifaceLog.encodeFunctionData("log", [ethers.id("d" + (i % 5000)), 1700000000 + i, 1000 + i, ethers.id("s" + i)]); }
    else if (mode === "store") { to = deployed.NaiveReadingStore; data = ifaceStore.encodeFunctionData("store", [ethers.id("d" + (i % 5000)), 1700000000 + i, 1000 + i, ethers.id("s" + i)]); }
    else { to = deployed.AnchorRegistry; seqs[s]++; data = ifaceAnc.encodeFunctionData("anchor", [seqs[s], ethers.id("root" + label + i), 333, 0, 1]); }
    const raw = await w.signTransaction({ type: 0, chainId: 1337, nonce: nonces[s]++, to, data, gasLimit: GASLIM[mode], gasPrice: 0n });
    txs.push({ raw, hash: ethers.keccak256(raw) });
  }
  const sent = new Map();
  const seen = new Map();
  const blocks = [];
  let lastBlock = await p0.getBlockNumber();
  let polling = true;
  const poller = (async () => {
    while (polling) {
      const bn = await p0.getBlockNumber();
      for (let b = lastBlock + 1; b <= bn; b++) {
        let blk = null; for (let k = 0; k < 20 && !blk; k++) { blk = await p0.send("eth_getBlockByNumber", [ethers.toQuantity(b), false]); if (!blk) await new Promise((r) => setTimeout(r, 100)); }
        if (!blk) continue;
        const t = Date.now();
        blocks.push({ n: b, t, txs: blk.transactions.length, gasUsed: Number(blk.gasUsed), ts: Number(blk.timestamp) });
        for (const h of blk.transactions) if (!seen.has(h)) seen.set(h, t);
      }
      lastBlock = bn;
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  // open-loop submission at RATE
  const t0 = Date.now(); let errors = 0;
  const pend = [];
  for (let i = 0; i < total; i++) {
    const due = t0 + (i * 1000) / RATE; const d = due - Date.now();
    if (d > 0) await new Promise((r) => setTimeout(r, d));
    const prov = providers[i % providers.length];
    sent.set(txs[i].hash, Date.now());
    pend.push(prov.send("eth_sendRawTransaction", [txs[i].raw]).catch(() => { errors++; }));
  }
  await Promise.all(pend);
  const tSubmitEnd = Date.now();
  // drain: wait until all seen or 60 s
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && [...sent.keys()].some((h) => !seen.has(h))) await new Promise((r) => setTimeout(r, 500));
  polling = false; await poller;
  const lat = []; let included = 0; let lastIncl = 0;
  for (const [h, ts] of sent) if (seen.has(h)) { included++; lat.push((seen.get(h) - ts) / 1000); lastIncl = Math.max(lastIncl, seen.get(h)); }
  lat.sort((a, b) => a - b);
  const q = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : null);
  const span = (lastIncl - t0) / 1000;
  const res = { label, mode, offered_tps: RATE, duration_s: DUR, submitted: total, rpc_errors: errors, included, inclusion_ratio: included / total,
    achieved_tps: included / span, submit_span_s: (tSubmitEnd - t0) / 1000, latency_median_s: q(0.5), latency_p95_s: q(0.95), latency_p99_s: q(0.99),
    blocks: blocks.length, mean_block_interval_s: blocks.length > 1 ? (blocks[blocks.length - 1].ts - blocks[0].ts) / (blocks.length - 1) : null,
    max_txs_per_block: Math.max(0, ...blocks.map((b) => b.txs)), max_gas_per_block: Math.max(0, ...blocks.map((b) => b.gasUsed)) };
  fs.mkdirSync(path.join(__dirname, "..", "results"), { recursive: true });
  fs.appendFileSync(path.join(__dirname, "..", "results", "besu_runs.jsonl"), JSON.stringify(res) + "\n");
  console.log(JSON.stringify(res));
}
main().catch((e) => { console.error(e); process.exit(1); });
