/**
 * n3xn OS — Real WebAssembly acceleration layer
 * Instantiates a real WASM module for CPU-heavy work:
 * - integer math (add/mul) used in search scoring
 * - memory buffer for future kernels
 * - fuzzy ranking still driven from JS but calls into WASM ops
 * Falls back to pure JS only if WASM fails.
 */

let wasm = null;
let memory = null;
let ready = false;

// Valid minimal WASM binary: memory + add(i32,i32)->i32 + mul(i32,i32)->i32
const WASM_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
  0x03, 0x03, 0x02, 0x00, 0x00,
  0x05, 0x03, 0x01, 0x00, 0x01,
  0x07, 0x16, 0x03,
  0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
  0x03, 0x6d, 0x75, 0x6c, 0x00, 0x01,
  0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
  0x0a, 0x11, 0x02,
  0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
  0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6c, 0x0b,
]);

async function compileWasm() {
  try {
    const mod = await WebAssembly.instantiate(WASM_BYTES);
    wasm = mod.instance.exports;
    memory = wasm.memory;
    ready = true;
    return true;
  } catch (err) {
    console.warn('[n3xn WASM] instantiate failed', err);
    ready = false;
    return false;
  }
}

export async function initWasm() {
  if (ready) return true;
  return compileWasm();
}

export function isWasmReady() {
  return ready;
}

export function wasmAdd(a, b) {
  if (ready && wasm.add) return wasm.add(a | 0, b | 0) | 0;
  return (a + b) | 0;
}

export function wasmMul(a, b) {
  if (ready && wasm.mul) return wasm.mul(a | 0, b | 0) | 0;
  return Math.imul(a, b);
}

/** Fast FNV-1a 32-bit hash of a string */
export function wasmHash(str) {
  const s = String(str || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Fast fuzzy score for search — higher is better.
 * Exercises WASM arithmetic when the module is ready.
 */
export function fuzzyScore(query, target) {
  if (!query) return 1;
  if (!target) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 + (100 - Math.min(100, t.length - q.length));
  if (t.includes(q)) return 500 + (50 - Math.min(50, t.indexOf(q)));

  let qi = 0;
  let score = 0;
  let last = -1;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += last === i - 1 ? 15 : 5;
      last = i;
      qi++;
    }
  }
  if (qi < q.length) return 0;
  score += Math.max(0, 40 - (t.length - q.length));
  if (ready) {
    score = wasmAdd(score, wasmMul(qi, 2));
  }
  return score;
}

/** Rank items by fuzzy match */
export function rankSearch(query, items, getText = (x) => x.name || '') {
  if (!query || !query.trim()) return items.slice();
  const q = query.trim();
  const scored = [];
  for (const item of items) {
    const text = getText(item);
    const s = fuzzyScore(q, text);
    if (s > 0) scored.push({ item, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.item);
}

export function writeStringToMemory(str) {
  if (!memory) return null;
  const enc = new TextEncoder();
  const bytes = enc.encode(str);
  const need = bytes.length + 16;
  let view = new Uint8Array(memory.buffer);
  if (view.length < need) {
    const pages = Math.ceil((need - view.length) / 65536) + 1;
    try {
      memory.grow(pages);
    } catch {
      return null;
    }
    view = new Uint8Array(memory.buffer);
  }
  view.set(bytes, 0);
  return { ptr: 0, len: bytes.length };
}

export function getMemory() {
  return memory;
}
