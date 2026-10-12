// Podepsané odhlašovací odkazy.
//
// Adresa se do odkazu dává zakódovaná a podepsaná klíčem ODHLASENI_TAJEMSTVI,
// aby se z odkazu nedal odhlásit někdo cizí jen tím, že si v adrese přepíše
// e-mail. Stejné schéma používá i rozesílka v CRM — klíč musí být na obou
// stranách stejný, jinak podpis nesedí.
//
// `seznam` rozlišuje, odkud se člověk odhlašuje:
//   (prázdné) — rozesílka z CRM, zápis do tabulky `zakazane`
//   'pes'     — hlídací pes, vypne se řádek v `hlidaci_pes`

const { createHmac, timingSafeEqual } = require('node:crypto');

const TAJEMSTVI = process.env.ODHLASENI_TAJEMSTVI;
const SEZNAMY = new Set(['', 'pes']);

function podpis(email) {
    return createHmac('sha256', TAJEMSTVI).update(email).digest('base64url').slice(0, 16);
}

/** Celá adresa odhlašovacího odkazu pro daný e-mail. Bez klíče vrací null. */
function odhlasovaciOdkaz(email, seznam = '') {
    if (!TAJEMSTVI) return null;
    const cisty = String(email).trim().toLowerCase();
    const e = Buffer.from(cisty, 'utf8').toString('base64url');
    const adresa = `https://www.janrehacek.com/odhlasit?e=${e}&p=${podpis(cisty)}`;
    return seznam ? `${adresa}&s=${encodeURIComponent(seznam)}` : adresa;
}

/** Ověří podpis a vrátí adresu, nebo null. */
function adresaZOdkazu(e, p) {
    if (!e || !p || !TAJEMSTVI) return null;
    let email;
    try { email = Buffer.from(String(e), 'base64url').toString('utf8').trim().toLowerCase(); }
    catch { return null; }
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) return null;
    const a = Buffer.from(String(p));
    const b = Buffer.from(podpis(email));
    // Porovnání konstantní dobou — ať z délky odpovědi nejde podpis uhádnout.
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return email;
}

function platnySeznam(s) {
    const v = String(s || '').trim();
    return SEZNAMY.has(v) ? v : '';
}

module.exports = { odhlasovaciOdkaz, adresaZOdkazu, platnySeznam };
