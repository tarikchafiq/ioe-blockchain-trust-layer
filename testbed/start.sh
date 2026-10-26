#!/bin/bash
# Start N (default 4) Besu QBFT validators on localhost.
cd /home/claude/work/besu
N=${1:-4}
[ -f pids ] && kill $(cat pids) 2>/dev/null; rm -f pids; sleep 3
KEYS=($(ls networkFiles/keys))
BOOT_PUB=$(sed 's/^0x//' networkFiles/keys/${KEYS[0]}/key.pub)
for ((i=0; i<N; i++)); do
  D=node$i; rm -rf $D; mkdir -p $D/data; cp networkFiles/keys/${KEYS[$i]}/key* $D/data/
  BOOT=""; [ $i -gt 0 ] && BOOT="--bootnodes=enode://$BOOT_PUB@127.0.0.1:30303"
  BESU_OPTS="-Xmx900m" nohup ./besu-25.10.0/bin/besu --data-path=$D/data --genesis-file=networkFiles/genesis.json $BOOT \
    --p2p-port=$((30303+i)) --rpc-http-enabled --rpc-http-api=ETH,NET,QBFT,TXPOOL,WEB3 --host-allowlist="*" \
    --rpc-http-port=$((8545+i)) --min-gas-price=0 --tx-pool-max-future-by-sender=2000 \
    --rpc-http-max-active-connections=500 --logging=WARN > $D/log.txt 2>&1 &
  echo $! >> pids
  sleep 3
done
