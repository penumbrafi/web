# ark-ff 0.4.2 + wasm32 32-bit Montgomery arithmetic (frozen for @penumbrafi/wasm 57.0.0)

Frozen 2026-10-02. Only `src/fields/models/fp/montgomery_backend.rs` differs from
crates.io ark-ff 0.4.2 (`WASM32-MONT.diff`, sha256 of the file
b2e534e25e58611f3eb9cec24d2869014ee2610e8d17ac009440507749f2fca6). Every non-wasm32
target compiles the stock code unchanged.

Use from penumbra-web: `[patch.crates-io] ark-ff = { path = "patches/ark-ff" }` in
packages/wasm/crate/Cargo.toml (next to ark-groth16).

## What changed

wasm32 has no 64x64->128 multiply, so the u64 CIOS turns each limb product into
several i64 multiplies. `mod mont32` runs the same Montgomery arithmetic on 32-bit
limbs with u64 accumulators, for the 4-limb (BLS12-377 Fr) and 6-limb (Fq)
fields. Same radix R = 2^(64N) = 2^(32*2N), fully reduced results, so output limbs
are identical to stock.

- `mul_assign`: fixed-size CIOS (`cios8` / `cios12`)
- `square_in_place`: cross products once, doubled, plus the diagonal, then one
  Montgomery reduction (`sqrN` + `redcN`)
- `sum_of_products`, M == 2 (Fq2 multiplication): both double-width products
  summed, one reduction. Valid because a0*b0 + a1*b1 < 2p^2 < p*R. Other M fall
  back to a sum of `*` products.

The hooks are in `impl FpConfig<N> for MontBackend<T, N>`, not in the
`MontConfig` defaults: `#[derive(MontConfig)]` generates its own
`mul_assign` / `square_in_place` / `sum_of_products`, which override those defaults.

wasm32 is little-endian, so `[u64; N]` and `[u32; 2N]` are reinterpreted with
`transmute_copy`; the modulus is split once per field at compile time.

## Constant time

There are no data-dependent branches or loop bounds on the wasm path:
- carries ripple a fixed number of limbs (row-to-row carry in redc; schoolbook
  carry into a known-zero limb in the wide product)
- the final "subtract p if >= p" is computed unconditionally and selected with a
  mask (`reduce_once`)
- the only `while` is the compile-time modulus split (public data)

Stock ark-ff 0.4.2 itself branches in `subtract_modulus` (is_geq_modulus); on wasm32
that branch is no longer reached for 4- and 6-limb fields.

Not affected: decaf377's own Fq/Fr use its fiat-crypto backend, not ark-ff's
MontBackend.

## Tests run (all on wasm32 in headless Chromium, threaded build)

Bench crate: /steam/rotko/prover-research-20261002/bench-wasm-mt
(`./build.sh out-ff ff`, `node serve-and-run.cjs out-ff <threads> <n> [diff|field]`)

- `difftest(200000)`: PASS. Raw Montgomery limbs checked against a num-bigint
  reference (a*b*R^-1 mod p). For each of Fq and Fr: mul, square,
  sum_of_products M = 2 and M = 3, over every pair of the edge set (0, 1, 2,
  p-1, p-2, p-3, R mod p, R^2 mod p, low-k-limbs-saturated values < p, p minus a
  high-limb bit) plus 200,000 random pairs. That is 803,600 Fq + 801,936 Fr
  checks. Fq2 mul is checked against (a0b0 - 5 a1b1) + (a0b1 + a1b0)u over
  200,000 random pairs; the -5 nonresidue is asserted against Fq2Config.
  The same test passes on the stock build, which validates the harness.
- `fieldcheck`: 200,000- and 1,000,000-step Fq/Fr/Fq2 mul+square chains hash
  identically to native stock (b26c4049f53674cb / 4f00458ad22437ec).
- Proofs: spend and output proofs with fixed (r, s) are byte-identical to native
  stock (8d5185955a200d34 / 1022ebbbe96e5520), which verify against the shipped
  verifying keys.

NOT run here (penumbra-web gate 2): the crate's key/address/asset vectors and the
serial-vs-threaded build test.

## Measured (headless Chromium, threaded wasm, Ryzen 9 7945HX, machine shared)

Fq mul 322 -> ~220 ns, Fq square 265 -> ~183 ns, Fq2 mul 915 -> ~614 ns.
Full send (1 spend + 2 outputs), warm median, 32 threads: 2.77 s (groth16 patch
only) -> ~1.65 s with this patch, about -40%.

## Vendored in penumbra-web

Comment-only change against the frozen file: the duplicated paragraph is
removed and `mod mont32` sits above `MontConfig`'s doc comment, so the trait
keeps its docs. Every code line is unchanged; sha256 here is
45bb0ae58621f9c076d19033b64ce80c1d72a9b03c36e439d9842960e148e918.
