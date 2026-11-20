import { ethers } from 'ethers';

const returnData = (hex, codeOffset) => {
  const length = ethers.getBytes(hex).length;
  const bytes = [
    0x5b,
    0x61, length >> 8, length & 0xff,
    0x61, codeOffset >> 8, codeOffset & 0xff,
    0x61, 0, 0,
    0x39,
    0x61, length >> 8, length & 0xff,
    0x60, 0,
    0xf3,
  ];
  return [...bytes, ...ethers.getBytes(hex)];
};

export const returnContract = ({ fallback, routes = {} }) => {
  const entries = Object.entries(routes);
  const dispatchLength = entries.length * 16;
  const blocks = [];
  if (fallback !== undefined) blocks.push({ data: fallback });
  for (const [selector, data] of entries) blocks.push({ selector, data });
  const targets = new Map();
  let at = dispatchLength;
  for (const block of blocks) {
    if (block.selector) targets.set(block.selector, at);
    block.at = at;
    at += 17 + ethers.getBytes(block.data).length;
  }
  const bytes = [];
  for (const [selector] of entries) {
    const target = targets.get(selector);
    bytes.push(0x60, 0, 0x35, 0x60, 0xe0, 0x1c, 0x63, ...ethers.getBytes(selector), 0x14, 0x61, target >> 8, target & 0xff, 0x57);
  }
  for (const block of blocks) bytes.push(...returnData(block.data, block.at + 17));
  return ethers.hexlify(Uint8Array.from(bytes));
};
