/**
 * Troca a URL legada do gtoken pela URL moderna do Google OAuth.
 * Executado automaticamente via postinstall após npm install.
 *
 * OLD: https://www.googleapis.com/oauth2/v4/token  (legada, falha no GitHub Actions)
 * NEW: https://oauth2.googleapis.com/token          (recomendada pelo Google)
 */
const fs = require('fs');
const path = require('path');

const OLD_URL = 'https://www.googleapis.com/oauth2/v4/token';
const NEW_URL = 'https://oauth2.googleapis.com/token';

const gtokenFile = path.join(__dirname, 'node_modules/gtoken/build/src/index.js');

if (!fs.existsSync(gtokenFile)) {
  console.log('[patch-gtoken] arquivo não encontrado, pulando');
  process.exit(0);
}

let src = fs.readFileSync(gtokenFile, 'utf8');

if (src.includes(NEW_URL)) {
  console.log('[patch-gtoken] já aplicado, nada a fazer');
  process.exit(0);
}

if (!src.includes(OLD_URL)) {
  console.log('[patch-gtoken] URL não encontrada no gtoken, verificar versão');
  process.exit(0);
}

const count = (src.match(new RegExp(OLD_URL.replace(/\//g, '\\/'), 'g')) || []).length;
src = src.split(OLD_URL).join(NEW_URL);
fs.writeFileSync(gtokenFile, src, 'utf8');
console.log(`[patch-gtoken] OK — ${count} ocorrência(s) de "${OLD_URL}" → "${NEW_URL}"`);
