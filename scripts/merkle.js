// Sorted-pair keccak256 Merkle tree (compatible with AnchorRegistry.verifyInclusion)
const { keccak256, concat, getBytes, hexlify } = require("ethers");

function hashPair(a, b) {
  // compare as big-endian byte strings
  return Buffer.compare(Buffer.from(getBytes(a)), Buffer.from(getBytes(b))) < 0
    ? keccak256(concat([a, b]))
    : keccak256(concat([b, a]));
}

/** Build all layers. Odd node at a level is promoted unchanged (no duplication -> no CVE-2012-2459-style ambiguity). */
function buildTree(leaves) {
  if (leaves.length === 0) throw new Error("empty");
  const layers = [leaves.slice()];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i]);
    }
    layers.push(next);
  }
  return layers;
}

function root(layers) { return layers[layers.length - 1][0]; }

function proof(layers, index) {
  const out = [];
  for (let l = 0; l < layers.length - 1; l++) {
    const layer = layers[l];
    const sib = index ^ 1;
    if (sib < layer.length) out.push(layer[sib]);
    index = index >> 1;
  }
  return out;
}

function verify(leaf, prf, rt) {
  let h = leaf;
  for (const p of prf) h = hashPair(h, p);
  return h === rt;
}

module.exports = { buildTree, root, proof, verify, hashPair };
