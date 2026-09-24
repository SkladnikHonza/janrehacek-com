#!/usr/bin/env node
/**
 * nahled.js — místní náhled webu na http://localhost:4200
 *
 * Servíruje přímo zdrojové soubory, ne dist/ — změna v HTML nebo CSS je vidět
 * hned po uložení a stisku F5, žádný build se nečeká.
 *
 * Napodobuje nastavení z vercel.json, aby se náhled choval jako ostrý web:
 *   cleanUrls      /rekonstrukce  →  rekonstrukce.html
 *   trailingSlash  /nabidka/      →  přesměruje na /nabidka
 *   redirects      stejná jako na Vercelu
 *   404            vlastní stránka 404.html
 *   /api/kontakt   pouští skutečnou funkci z api/kontakt.js
 *
 * Bez závislostí. Spuštění: node nahled.js  (nebo dvojklik na Spustit-nahled.command)
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const KOREN = __dirname;
const PORT = Number(process.env.PORT) || 4200;

// Soubory, které na web nepatří — stejný výběr jako SKIP_ROOT v build.js.
const NEVEREJNE = new Set(['README.md', 'AGENTS.md', 'build.js', 'nahled.js', 'vercel.json',
    'package.json', 'package-lock.json', 'Spustit-nahled.command']);
const NEVEREJNE_SLOZKY = ['_templates/', 'dist/', 'node_modules/', '.git/', '.vercel/'];

const PRESMEROVANI = {
    '/nabidka/havirov-jarosova': '/nabidka/pronajem/havirov-jarosova',
};

const TYPY = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.pdf': 'application/pdf',
};

const jeSkryty = (rel) =>
    NEVEREJNE.has(rel) ||
    NEVEREJNE_SLOZKY.some((d) => rel === d.slice(0, -1) || rel.startsWith(d)) ||
    rel.split('/').some((c) => c.startsWith('.')) ||
    rel.endsWith('/info.md');

const soubor = (rel) => {
    const cela = path.join(KOREN, rel);
    // pojistka proti ../ mimo složku projektu
    if (!cela.startsWith(KOREN)) return null;
    try { return fs.statSync(cela).isFile() ? cela : null; } catch { return null; }
};

function posli(res, kod, cesta) {
    const telo = fs.readFileSync(cesta);
    res.writeHead(kod, {
        'Content-Type': TYPY[path.extname(cesta).toLowerCase()] || 'application/octet-stream',
        'Content-Length': telo.length,
        'Cache-Control': 'no-store',          // v náhledu nechceme nic z mezipaměti
    });
    res.end(telo);
}

/**
 * Funkce v api/ běží na Vercelu, kde jsou na odpovědi navíc `status()` a `json()`.
 * Obyčejný Node je nemá, takže je tu doplňujeme — jinak funkce spadne na 500.
 */
function dopln(res) {
    res.status = (kod) => { res.statusCode = kod; return res; };
    res.json = (telo) => {
        const data = JSON.stringify(telo);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(data);
        return res;
    };
    return res;
}

const server = http.createServer(async (req, res) => {
    let cesta;
    try { cesta = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400).end('Špatná adresa'); return; }

    // kontaktní formulář — pouští se skutečná funkce, včetně hlídky Originu
    if (cesta === '/api/kontakt') {
        try {
            delete require.cache[require.resolve('./api/kontakt.js')];  // ať se načte i po úpravě
            await require('./api/kontakt.js')(req, dopln(res));
        } catch (e) {
            console.error('api/kontakt spadlo:', e);
            if (!res.headersSent) res.writeHead(500).end('Chyba funkce');
        }
        return;
    }

    if (PRESMEROVANI[cesta]) {
        res.writeHead(308, { Location: PRESMEROVANI[cesta] }).end();
        return;
    }
    // trailingSlash: false
    if (cesta.length > 1 && cesta.endsWith('/')) {
        res.writeHead(308, { Location: cesta.slice(0, -1) }).end();
        return;
    }

    const rel = cesta.replace(/^\/+/, '');
    if (jeSkryty(rel)) { res.writeHead(403).end('Nepřístupné'); return; }

    const nalez =
        (rel === '' ? soubor('index.html') : null) ||
        soubor(rel) ||
        soubor(rel + '.html') ||           // cleanUrls
        soubor(path.join(rel, 'index.html'));

    if (nalez) {
        // cleanUrls: /about.html přesměruj na /about, ať se adresy neduplikují
        if (rel.endsWith('.html') && !rel.endsWith('index.html')) {
            res.writeHead(308, { Location: '/' + rel.slice(0, -5) }).end();
            return;
        }
        posli(res, 200, nalez);
        return;
    }

    const chybova = soubor('404.html');
    if (chybova) posli(res, 404, chybova);
    else res.writeHead(404).end('Nenalezeno');
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`\n  Náhled webu běží:  http://localhost:${PORT}\n`);
    console.log('  Změny v HTML, CSS a JS stačí uložit a dát F5 — build se nepouští.');
    console.log('  Ukončíš to klávesami Ctrl+C.\n');
});
