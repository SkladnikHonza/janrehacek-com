// Společná protispamová ochrana formulářů.
//
// PROČ TO JE TADY: sít je víc (povolený Origin, skryté pole, doba vyplňování,
// omezení počtu, Turnstile) a každý formulář na webu je potřebuje stejné.
// Když se objevil druhý formulář, bylo na výběr mezi kopií té logiky a jedním
// modulem. Kopie je u bezpečnostního kódu špatně: 29. 9. 2026 tudy prolezl
// robot, záplata se psala jednou — a při dvou kopiích by se na tu druhou
// zapomnělo.
//
// Proměnné prostředí:
//   KONTAKT_ORIGINY    nepovinné, další povolené adresy webu oddělené čárkou
//   TURNSTILE_SECRET   nepovinné; bez něj se ověření přeskočí, aby se formulář
//                      nerozbil dřív, než se klíče doplní

// Odkud smí poptávka přijít. Automat obvykle pošle POST přímo na API
// a žádnou hlavičku Origin ani Referer nemá — tím se odfiltruje.
const DOMENY = new Set([
    'janrehacek.com', 'www.janrehacek.com', 'localhost', '127.0.0.1',
    ...(process.env.KONTAKT_ORIGINY || '').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean),
]);

function zNasehoWebu(req) {
    const zdroj = req.headers.origin || req.headers.referer || '';
    if (!zdroj) return false;
    let host;
    try { host = new URL(zdroj).hostname.toLowerCase(); } catch { return false; }
    if (DOMENY.has(host)) return true;
    // Náhledová nasazení na Vercelu; v ostrém provozu se nepouštějí.
    return process.env.VERCEL_ENV !== 'production' && host.endsWith('.vercel.app');
}

// Člověk formulář nevyplní za tři sekundy. Stránka posílá v poli `trvani`,
// jak dlouho byl formulář otevřený (v ms).
const NEJKRATSI_VYPLNENI = 3000;

// Hrubá pojistka proti zaplavení: na jednu instanci 5 zpráv z IP za 10 minut.
const historie = new Map();
function prilisCasto(ip, strop = 5) {
    const ted = Date.now();
    const casy = (historie.get(ip) || []).filter((t) => ted - t < 10 * 60 * 1000);
    casy.push(ted);
    historie.set(ip, casy);
    if (historie.size > 500) for (const [k, v] of historie) if (!v.some((t) => ted - t < 10 * 60 * 1000)) historie.delete(k);
    return casy.length > strop;
}

// Ověření Turnstile u Cloudflare. Bez nastaveného klíče se přeskakuje.
async function turnstileSedi(token, ip) {
    const tajne = process.env.TURNSTILE_SECRET;
    if (!tajne) return { ok: true, preskoceno: true };
    if (!token) return { ok: false, duvod: 'chybí token' };
    try {
        const telo = new URLSearchParams({ secret: tajne, response: token });
        if (ip) telo.set('remoteip', ip);
        const odp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: telo,
        });
        const v = await odp.json();
        return v.success ? { ok: true } : { ok: false, duvod: (v['error-codes'] || []).join(',') };
    } catch (e) {
        // Když je Cloudflare nedostupná, zprávu radši pustíme — přijít o poptávku
        // je horší než pustit jeden spam.
        console.error('Turnstile nedostupný:', e.message);
        return { ok: true, preskoceno: true };
    }
}

/** Odesláno klasicky, bez JavaScriptu? Pak to v adrese neskončí JSONem. */
function jeNavigace(req) {
    return !String(req.headers['content-type'] || '').includes('application/json');
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function nactiTelo(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    let surove = '';
    for await (const kus of req) surove += kus;
    if (!surove) return {};
    const typ = String(req.headers['content-type'] || '');
    if (typ.includes('application/json')) { try { return JSON.parse(surove); } catch { return {}; } }
    return Object.fromEntries(new URLSearchParams(surove));
}

function ipZadatele(req) {
    return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'neznama';
}

/**
 * Projde sítem všechno, co nesouvisí s obsahem konkrétního formuláře.
 * Vrací { prosel: true, ip } nebo { prosel: false, stav, telo } k rovnou odeslání.
 *
 * `tiche` jsou pasti, u kterých se robotovi NESMÍ prozradit, že neprošel —
 * odpoví se 200 {ok:true}, jako by se zpráva odeslala.
 *
 * `zkontrolujPole` je nepovinná funkce, která vrátí text chyby, když formuláři
 * něco chybí. Volá se uprostřed síta, aby zůstalo pořadí kontrol z původní
 * kontaktní funkce.
 */
async function prosejPozadavek(req, data, zkontrolujPole) {
    if (!zNasehoWebu(req)) {
        console.warn('Odmítnuto — mimo web:', req.headers.origin || req.headers.referer || 'bez hlavičky');
        return { prosel: false, stav: 403, telo: { chyba: 'Formulář odešlete prosím ze stránek janrehacek.com.' } };
    }

    // Past na roboty: pole je v HTML skryté, člověk ho nevyplní.
    if (String(data.botcheck || '').trim()) return { prosel: false, stav: 200, telo: { ok: true }, tiche: true };

    // Druhá past: doba vyplňování. Pole doplňuje stránka, takže ho automat,
    // který posílá POST bez načtení stránky, nemá odkud vzít. Chybějící hodnota
    // se proto ODMÍTÁ — právě tudy prolezl robot 29. 9. 2026.
    const zmereno = String(data.trvani || '').trim();
    const trvani = Number(zmereno);
    if (!zmereno || !Number.isFinite(trvani) || trvani < NEJKRATSI_VYPLNENI) {
        console.warn('Odmítnuto — doba vyplňování:', zmereno || 'chybí');
        return { prosel: false, stav: 200, telo: { ok: true }, tiche: true };
    }

    // Obsah formuláře se kontroluje TADY, mezi tichými pastmi a zbytkem.
    // Pořadí není libovolné: nesmyslný vstup má dostat 400 dřív, než se
    // započítá do limitu nebo spotřebuje jednorázový token od Turnstile.
    if (zkontrolujPole) {
        const chyba = zkontrolujPole();
        if (chyba) return { prosel: false, stav: 400, telo: { chyba } };
    }

    const ip = ipZadatele(req);
    if (prilisCasto(ip)) {
        return { prosel: false, stav: 429, telo: { chyba: 'Zpráv z jedné adresy je příliš mnoho. Zkuste to prosím za chvíli.' } };
    }

    // Čtvrté síto: Turnstile. Na rozdíl od ostatních pozná i automat, který si
    // pustí skutečný prohlížeč — a právě ty ostatní síta neodchytí.
    const t = await turnstileSedi(data['cf-turnstile-response'], ip === 'neznama' ? '' : ip);
    if (!t.ok) {
        console.warn('Odmítnuto — Turnstile:', t.duvod);
        return { prosel: false, stav: 400, telo: { chyba: 'Nepodařilo se ověřit, že nejste robot. Zkuste to prosím znovu.' } };
    }

    return { prosel: true, ip };
}

module.exports = {
    DOMENY, NEJKRATSI_VYPLNENI,
    zNasehoWebu, prilisCasto, turnstileSedi, escapeHtml, nactiTelo, ipZadatele, prosejPozadavek, jeNavigace,
};
