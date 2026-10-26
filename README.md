# IoE edge-anchored blockchain trust layer — supplementary material

Reproduces every number, table and figure of the manuscript.

## Contents
- `contracts/` — IoERegistry, AccessPolicy, AnchorRegistry, EnergyMarket (+ baselines, attacker and vulnerable control contracts)
- `test/` — 23 functional/adversarial tests (A1–A20) + re-entrancy control case
- `scripts/gas.js` — gas measurements -> `results/gas.json`
- `bench/crypto_bench.py`, `bench/merge_c_bench.py` — signature/hash/Merkle benchmarks -> `results/crypto.json`
  (C-level numbers: `openssl speed -seconds 3 ed25519 ecdsap256`; liboqs 0.14.0 `tests/speed_sig <alg> -d 5` -> `results/liboqs_speed.txt`)
- `bench/scalability_sim.py` — capacity, queueing and latency model -> `results/scalability.json`
- `bench/figures.py`, `bench/diagrams.py` — figures in `figs/`

## Run
    npm install --legacy-peer-deps
    npx hardhat test
    npx hardhat run scripts/gas.js
    pip install cryptography pycryptodome pqcrypto numpy matplotlib
    python3 bench/crypto_bench.py && python3 bench/merge_c_bench.py
    python3 bench/scalability_sim.py && python3 bench/figures.py && python3 bench/diagrams.py

Note: hardhat.config.js compiles with the solc-js 0.8.24 bundled in node_modules (offline build).
Toolchain used: Node 22, Hardhat 2.22.17, Solidity 0.8.24 (optimizer 200 runs, Cancun), Python 3.13.

## Version 2 additions
- `contracts/EnergyMarketV2.sol` — meter-signed delivery attestation (tests A21–A24 in `test/attested.test.js`)
- `contracts/Baselines2.sol` — stronger baselines BatchHashLog and DeviceHashChains (`scripts/gas2.js` -> `results/gas2.json`)
- `test/gaps.test.js` — 26 tests added after mutation analysis (suite: 55 tests + 1 control)
- `bench/mutation.py` — mutation analysis (`results/mutation_initial.json`: 60.4 %, `results/mutation_final.json`: 97.3 %)
- `fuzz/fuzz.invariants.js` — stateful invariant fuzzing: `FUZZ_SEQ=200 FUZZ_STEPS=60 npx hardhat test fuzz/fuzz.invariants.js`
- `results/slither.json` — Slither 0.11.6 report
- `testbed/` + `scripts/besu_*.js|sh` — 4-validator Hyperledger Besu 25.10.0 QBFT testbed (`results/besu_runs.jsonl`)
- `results/pqm4_m4.json` — Cortex-M4 figures extracted from pqm4 (commit 6ff2be9)
