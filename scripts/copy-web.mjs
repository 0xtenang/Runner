// Copies the website's static files into www/ for the phone apps (Capacitor).
// The website itself has no build step; this only feeds `npx cap sync`.
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const FILES = ['index.html', 'styles.css', 'icon.svg', 'manifest.webmanifest', 'js'];
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of FILES) cpSync(f, `www/${f}`, { recursive: true });
console.log('Copied web app into www/');
