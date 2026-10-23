// GET /nft/image/:id → SVG artwork (also "logo" and "banner" for the collection).
import { parseId, tokenImage, collectionImage } from './_meta.js';

export default function handler(req, res) {
  const raw = String(req.query.id || '');
  let svg;
  if (raw === 'logo' || raw === 'banner') svg = collectionImage(raw);
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
