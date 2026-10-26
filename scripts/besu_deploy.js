// Deploy the trust-layer contracts on the Besu QBFT network and enrol 20 gateways.
const { ethers } = require("ethers"); const fs = require("fs"); const path = require("path");
const acc = JSON.parse(fs.readFileSync("/home/claude/work/besu/accounts.json"));
const art = (f, n) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts/contracts", f, n + ".json")));
(async () => {
  const p = new ethers.JsonRpcProvider("http://127.0.0.1:8545", 1337, { staticNetwork: true });
  const admin = new ethers.NonceManager(new ethers.Wallet(acc[0].k, p));
  const dep = async (f, n, args = []) => { const a = art(f, n); const c = await new ethers.ContractFactory(a.abi, a.bytecode, admin).deploy(...args, { gasPrice: 0 }); await c.waitForDeployment(); return c; };
  const reg = await dep("IoERegistry.sol", "IoERegistry");
  const anc = await dep("AnchorRegistry.sol", "AnchorRegistry", [await reg.getAddress()]);
  const log = await dep("Baseline.sol", "NaiveReadingLog");
  const st = await dep("Baseline.sol", "NaiveReadingStore");
  for (const a of acc.slice(4, 24)) { const t = await reg.setGateway(a.a, true, { gasPrice: 0 }); await t.wait(); }
  const out = { IoERegistry: await reg.getAddress(), AnchorRegistry: await anc.getAddress(), NaiveReadingLog: await log.getAddress(), NaiveReadingStore: await st.getAddress() };
  fs.writeFileSync("/home/claude/work/besu/deployed.json", JSON.stringify(out, null, 1)); console.log(out);
})().catch((e) => { console.error(e); process.exit(1); });
