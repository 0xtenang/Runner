// GET /nft/image/:id → SVG artwork; "logo" and "banner" redirect to the collection PNGs in /nft/art/.
import { parseId, tokenImage } from './_meta.js';

export default function handler(req, res) {
  const raw = String(req.query.id || '');
  let svg;
  // The collection logo and banner are now the PNG artwork in /nft/art/ (IMD's Pepes, brand/).
  if (raw === 'logo' || raw === 'banner') { res.setHeader('Cache-Control', 'public, max-age=3600'); res.redirect(301, `/nft/art/${raw}.png`); return; }
  else {
    const id = parseId(raw);
    if (!id) { res.status(404).send('Unknown token'); return; }
    svg = tokenImage(id);
  }
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  res.status(200).send(svg);
}
