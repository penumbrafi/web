/**
 * WASM Module Initialization
 *
 * This module provides explicit initialization for the WASM module.
 * Required for --target web builds which need explicit initialization.
 *
 * Usage:
 *   import { initWasm, initWasmWithParallel } from '@penumbra-zone/wasm/init';
 *
 *   // For standard builds:
 *   await initWasm();
 *
 *   // For parallel builds with rayon (requires SharedArrayBuffer):
 *   await initWasmWithParallel(navigator.hardwareConcurrency);
 */

// Note: wasm-parallel is loaded dynamically only when initWasmWithParallel is called
// This avoids loading issues in contexts that don't support SharedArrayBuffer

let wasmInitialized = false;
let wasmInitPromise: Promise<void> | null = null;

/**
 * Check if SharedArrayBuffer is available (required for parallel builds).
 */
export const isParallelSupported = (): boolean => {
  return typeof SharedArrayBuffer !== 'undefined';
};

/**
 * Initialize the WASM module for standard (non-parallel) use.
 * With --target web, we need to explicitly call the init function.
 * Safe to call multiple times.
 */
export const initWasm = async (): Promise<void> => {
  if (wasmInitialized) return;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    // Import the wasm module's init function
    const wasmModule = await import('../wasm/index.js');
    // Call the default export (init function) to initialize the module
    await wasmModule.default();
    wasmInitialized = true;
    console.log('[WASM] Initialized (standard mode)');
  })();

  return wasmInitPromise;
};

/**
 * Initialize the WASM module with rayon parallel support.
 * Requires SharedArrayBuffer to be available.
 *
 * @param numThreads - Number of worker threads to spawn (default: navigator.hardwareConcurrency or 4)
 */
export const initWasmWithParallel = async (
  numThreads: number = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4,
): Promise<void> => {
  if (wasmInitialized) return;
  if (wasmInitPromise) return wasmInitPromise;

  if (!isParallelSupported()) {
    throw new Error(
      'SharedArrayBuffer is not available. Parallel WASM requires cross-origin isolation or Chrome extension context.',
    );
  }

  wasmInitPromise = (async () => {
    // Dynamically import parallel WASM module
    const parallelWasm = await import('../wasm-parallel/index.js');

    // Create shared memory for rayon threads
    // Initial: 512 pages (32MB), max: 65536 pages (4GB)
    // Note: maximum must match the WASM module's declared maximum (set via --max-memory linker flag)
    const memory = new WebAssembly.Memory({
      initial: 512,
      maximum: 65536,
      shared: true,
    });

    // Initialize the parallel WASM module with shared memory
    await parallelWasm.default({ memory });

    // Initialize the rayon thread pool
    await parallelWasm.initThreadPool(numThreads);

    wasmInitialized = true;
    console.log(`[WASM] Initialized with ${numThreads} parallel threads`);
  })();

  return wasmInitPromise;
};

/**
 * Check if the WASM module has been initialized.
 */
export const isWasmInitialized = (): boolean => wasmInitialized;

/**
 * Ensure WASM is initialized, initializing with parallel support if available.
 * This is a convenience function that auto-detects the best mode.
 */
export const ensureWasmReady = async (): Promise<boolean> => {
  if (wasmInitialized) return isParallelSupported();

  if (isParallelSupported()) {
    await initWasmWithParallel();
    return true;
  } else {
    await initWasm();
    return false;
  }
};
