// Kontaktní formulář → e-mail přes Resend.
//
// Klíč NIKDY nepatří do repozitáře (je veřejný) — je v proměnných prostředí projektu
// na Vercelu: Settings → Environment Variables.
//   RESEND_API_KEY       povinné, klíč z resend.com (Sending access)
//   KONTAKT_PRIJEMCE     nepovinné, kam poptávky chodí (výchozí invest@janrehacek.com)
//   KONTAKT_ODESILATEL   nepovinné, „Jméno <adresa>“; doména MUSÍ být v Resendu ověřená
//   KONTAKT_ORIGINY      nepovinné, další povolené adresy webu oddělené čárkou
//   TURNSTILE_SECRET     nepovinné; když je vyplněné, ověřuje se Turnstile od
//                        Cloudflare. Bez něj se ověření přeskočí, aby se formulář
//                        nerozbil dřív, než se klíče doplní.
//
// POST /api/kontakt — přijme JSON i klasické odeslání formuláře (bez JavaScriptu).
// Odpovědi: 200 {ok:true} · 303 na /dekuji (bez JS) · 400 chybný vstup ·
//           403 poptávka nepřišla z webu · 429 příliš mnoho zpráv ·
//           503 {kod:'bez-klice'} → web nabídne e-mail.
//
// Proti spamu stojí čtyři síta: povolený Origin (roboti posílají POST rovnou sem,
// hlavičku nemají), skryté pole botcheck, doba vyplňování formuláře a Turnstile.
//
// 29. 9. 2026 prolezl robot, který hlavičku Origin poslal správně a pole s dobou
// vyplňování prostě VYNECHAL — prázdná hodnota se tehdy pouštěla kvůli
// prohlížečům bez JavaScriptu. Dnes je pole povinné; kdo ho nepošle, neprojde.

// Příjemců může být víc, oddělují se čárkou. Přeposílaná adresa (invest@janrehacek.com
// je u Webglobe jen přeposílání) se cestou může ztratit, proto se hodí i cíl napřímo.
const PRIJEMCI = (process.env.KONTAKT_PRIJEMCE || 'invest@janrehacek.com')
    .split(',').map((a) => a.trim()).filter(Boolean);
const ODESILATEL = process.env.KONTAKT_ODESILATEL || 'Formulář janrehacek.com <formular@housio.app>';

// Odkud smí poptávka přijít. Automat obvykle pošle POST přímo na /api/kontakt
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

const DELKY = { name: 120, email: 160, phone: 60, interest: 80, message: 5000, nabidka: 300, odkud: 300, subject: 200 };

// Hrubá pojistka proti zaplavení: na jednu instanci 5 zpráv z IP za 10 minut.
const historie = new Map();
function prilisCasto(ip) {
    const ted = Date.now();
    const casy = (historie.get(ip) || []).filter((t) => ted - t < 10 * 60 * 1000);
    casy.push(ted);
    historie.set(ip, casy);
    if (historie.size > 500) for (const [k, v] of historie) if (!v.some((t) => ted - t < 10 * 60 * 1000)) historie.delete(k);
    return casy.length > 5;
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

module.exports = async (req, res) => {
    // `verze` slouží ke kontrole, že je nasazená očekávaná podoba funkce.
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ chyba: 'Použijte POST.', verze: 6 });
    }
    // S hlavičkou x-diagnostika vrátí odpověď i důvod, proč Resend zprávu odmítl.
    const diagnostika = Boolean(req.headers['x-diagnostika']);

    if (!zNasehoWebu(req)) {
        console.warn('Odmítnuto — mimo web:', req.headers.origin || req.headers.referer || 'bez hlavičky');
        return res.status(403).json({ chyba: 'Formulář odešlete prosím ze stránek janrehacek.com.' });
    }

    const data = await nactiTelo(req);
    const pole = {};
    for (const [k, max] of Object.entries(DELKY)) pole[k] = String(data[k] || '').trim().slice(0, max);

    // Past na roboty: pole je v HTML skryté, člověk ho nevyplní.
    if (String(data.botcheck || '').trim()) return res.status(200).json({ ok: true });

    // Druhá past: doba vyplňování. Pole doplňuje stránka, takže ho automat,
    // který posílá POST bez načtení stránky, nemá odkud vzít. Chybějící hodnota
    // se proto ODMÍTÁ — právě tudy prolezl robot 29. 9. 2026.
    const zmereno = String(data.trvani || '').trim();
    const trvani = Number(zmereno);
    if (!zmereno || !Number.isFinite(trvani) || trvani < NEJKRATSI_VYPLNENI) {
        console.warn('Odmítnuto — doba vyplňování:', zmereno || 'chybí');
        return res.status(200).json({ ok: true });
    }

    if (!pole.name || !pole.message || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(pole.email)) {
        return res.status(400).json({ chyba: 'Vyplňte prosím jméno, platný e-mail a zprávu.' });
    }

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'neznama';
    if (prilisCasto(ip)) return res.status(429).json({ chyba: 'Zpráv z jedné adresy je příliš mnoho. Zkuste to prosím za chvíli.' });

    // Čtvrté síto: Turnstile. Na rozdíl od ostatních pozná i automat, který si
    // pustí skutečný prohlížeč — a právě ty ostatní síta neodchytí.
    const t = await turnstileSedi(data['cf-turnstile-response'], ip === 'neznama' ? '' : ip);
    if (!t.ok) {
        console.warn('Odmítnuto — Turnstile:', t.duvod);
        return res.status(400).json({ chyba: 'Nepodařilo se ověřit, že nejste robot. Zkuste to prosím znovu.' });
    }

    const klic = process.env.RESEND_API_KEY;
    if (!klic) return res.status(503).json({ kod: 'bez-klice', chyba: 'Odesílání zatím není nastavené.' });

    const radky = [
        ['Jméno', pole.name],
        ['E-mail', pole.email],
        ['Telefon', pole.phone],
        ['Zájem', pole.interest],
        ['Nabídka', pole.nabidka],
        ['Přišel z', pole.odkud],
    ].filter(([, v]) => v);

    const html =
        '<table style="font:15px/1.6 -apple-system,Segoe UI,sans-serif;border-collapse:collapse">' +
        radky.map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#6b6b6b">${escapeHtml(k)}</td><td style="padding:4px 0"><b>${escapeHtml(v)}</b></td></tr>`).join('') +
        '</table><hr style="border:0;border-top:1px solid #e5e5e5;margin:18px 0">' +
        `<div style="font:15px/1.7 -apple-system,Segoe UI,sans-serif;white-space:pre-wrap">${escapeHtml(pole.message)}</div>`;
    const text = radky.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n\n' + pole.message;

    try {
        const odpoved = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${klic}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: ODESILATEL,
                to: PRIJEMCI,
                reply_to: pole.email,          // odpovídá se rovnou zájemci
                subject: pole.subject || `Nová poptávka z janrehacek.com — ${pole.name}`,
                html,
                text,
            }),
        });
        if (!odpoved.ok) {
            const chyba = await odpoved.text();
            console.error('Resend odmítl zprávu:', odpoved.status, chyba.slice(0, 300));
            return res.status(502).json({
                chyba: 'Zprávu se nepodařilo odeslat.',
                ...(diagnostika ? { stav: odpoved.status, detail: chyba.slice(0, 300) } : {}),
            });
        }
    } catch (e) {
        console.error('Resend nedostupný:', e);
        return res.status(502).json({
            chyba: 'Zprávu se nepodařilo odeslat.',
            ...(diagnostika ? { detail: String(e).slice(0, 300) } : {}),
        });
    }

    // Bez JavaScriptu skončí odeslání přechodem na stránku s poděkováním.
    if (!String(req.headers['content-type'] || '').includes('application/json')) {
        res.setHeader('Location', '/dekuji');
        return res.status(303).end();
    }
    return res.status(200).json({ ok: true });
};
