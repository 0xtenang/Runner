# Partner artwork

`character.png` / `character.svg`: IMD's character for the RUNNER logo and banners.

- **Rights:** IMD confirmed (reported by the project owner, 23 October 2026) that they own or license this character and allow RUNNER to use it in its logo, banners and NFT collection. Keep IMD's written confirmation on file.
- **Needed:** a transparent-background PNG (at least 1500 px tall) or a vector SVG. A running pose suits the layouts best.
- After adding or replacing the file, run `node brand/build.mjs`. The `*-imd.svg` files in `brand/out/` then embed it.

**Current stand-in:** `character.png` is frame 10 (running, facing right) of IMD's sprite sheet as used on our earlier project pepesimd.fun (`/img/imd-pepe.webp`, 19 frames of 240 × 284 px). It's low resolution, so replace it with IMD's full-size art when it arrives.

**Two Pepes (`*-pepes.svg`):** `imd-frame-10.png` and `imd-frame-08.png` are IMD's sprite frames. `brand/pepes.mjs` dresses them in PepesFamily NFT outfits, using the same colour-mask recipe and palette as pepesimd.fun:
- front runner: IMD's original Pepe (green skin, blue shirt, brown shorts);
- second runner: blue skin, purple shirt, white shorts, halo.

Change the looks in `runnerPepes()`.
