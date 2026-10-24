// Copies the website's static files into www/ for the phone apps (Capacitor).
// The website itself has no build step; this only feeds `npx cap sync`.
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const FILES = ['index.html', 'styles.css', 'icon.svg', 'manifest.webmanifest', 'js', 'fonts'];
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of FILES) cpSync(f, `www/${f}`, { recursive: true });

// The apps also load Capacitor's JS (registerPlugin etc.); the website doesn't.
cpSync('node_modules/@capacitor/core/dist/capacitor.js', 'www/capacitor.js');
const html = readFileSync('www/index.html', 'utf8');
const tag = '<script src="capacitor.js"></script>\n  <script type="module" src="js/app.js">';
if (!html.includes('<script type="module" src="js/app.js">')) throw new Error('index.html: app.js script tag not found');
writeFileSync('www/index.html', html.replace('<script type="module" src="js/app.js">', tag));
console.log('Copied web app into www/');
