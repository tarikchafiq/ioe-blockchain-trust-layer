#!/bin/bash
# Each run starts from a fresh 4-validator QBFT chain (no txpool backlog from previous runs).
cd /home/claude/work/proto
run() { # mode rate dur label
  if grep -q "\"label\":\"$4\",\"mode\":\"$1\",\"offered_tps\":$2," results/besu_runs.jsonl 2>/dev/null; then return; fi
  for attempt in 1 2 3; do
    /home/claude/work/besu/start.sh 4 > /dev/null 2>&1
    for i in $(seq 1 60); do curl -s -m 2 -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' localhost:8548 | grep -q '"0x[1-9a-f]' && break; sleep 2; done
    sleep 6
    if timeout 150 node scripts/besu_deploy.js > /dev/null 2>&1; then break; fi
    echo "deploy failed (attempt $attempt)"
  done
  sleep 4
  timeout 400 node scripts/besu_load.js "$4" $1 $2 $3
}
for rep in rep1 rep2; do
  for r in 25 50 100 150 200; do run log $r 30 $rep; done
  for r in 25 50 75 100; do run store $r 30 $rep; done
  for r in 3.3 50 150; do run anchor $r 30 $rep; done
done
echo DONE
