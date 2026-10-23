// GET /nft/:id → ERC-721 metadata JSON (tokenURI target).
import { parseId, tokenMetadata } from './_meta.js';

export default function handler(req, res) {
  const id = parseId(req.query.id);
  if (!id) { res.status(404).json({ error: 'Unknown token' }); return; }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  res.status(200).send(JSON.stringify(tokenMetadata(id)));
}
