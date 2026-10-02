/**
 * The penumbra wasm module, instantiated once per JavaScript context.
 *
 * Every wrapper in this package imports this file before it touches the
 * module, so importing any `@penumbrafi/wasm/*` entry point waits (top-level
 * await) until the module is ready and the wrappers can stay synchronous.
 *
 * There is one build. It is compiled with threads: its memory is a shared
 * `WebAssembly.Memory`, which needs `SharedArrayBuffer`, i.e. a
 * cross-origin-isolated context (COOP `same-origin` + COEP `require-corp`) or
 * Node. Without it the import fails here, loudly, instead of degrading.
 *
 * Instantiating does not start any threads; rayon runs on the calling thread
 * until a dedicated worker calls `startThreads` (see init.ts).
 */
import init, { initSync } from '../wasm/index.js';

// Pages of 64 KiB. The maximum must equal the module's declared maximum
// (--max-memory in crate/scripts/build-wasm.sh). Do NOT raise `initial` to
// pre-fit the ~100MB of proving keys: Rust's allocator only uses pages it
// obtained via memory.grow, so extra initial pages are never handed out.
const INITIAL_PAGES = 512;
const MAXIMUM_PAGES = 65536;

const sharedMemory = (): WebAssembly.Memory => {
  if (typeof SharedArrayBuffer === 'undefined') {
    throw new Error(
      '@penumbrafi/wasm needs SharedArrayBuffer: run it in a cross-origin-isolated context ' +
        '(Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: require-corp)',
    );
  }
  return new WebAssembly.Memory({ initial: INITIAL_PAGES, maximum: MAXIMUM_PAGES, shared: true });
};

// jsdom test environments are Node with a `window`; real browsers have neither
// process.versions.node nor a jsdom user agent (bundlers may shim `process`).
const isNode =
  typeof process !== 'undefined' &&
  typeof process.versions === 'object' &&
  typeof process.versions.node === 'string' &&
  (typeof window === 'undefined' ||
    (typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom')));

if (isNode) {
  // Node (tests, tooling) has no fetch for file: URLs; read the bytes.
  const { readFile } = await import(/* webpackIgnore: true */ 'node:fs/promises');
  const bytes = await readFile(new URL('../wasm/index_bg.wasm', import.meta.url));
  initSync({ module: bytes, memory: sharedMemory() });
} else {
  // A literal `new URL(…, import.meta.url)` is what bundlers recognise and
  // emit as an asset; it is the same file wasm-bindgen's glue points at.
  await init({
    module_or_path: new URL('../wasm/index_bg.wasm', import.meta.url),
    memory: sharedMemory(),
  });
}
