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

const {
    escapeHtml, nactiTelo, prosejPozadavek, jeNavigace,
} = require('../lib/ochrana');

const DELKY = { name: 120, email: 160, phone: 60, interest: 80, message: 5000, nabidka: 300, odkud: 300, subject: 200 };

const STRANKA_BEZ_JS = `<!DOCTYPE html>
<html lang="cs"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Zprávu se nepodařilo odeslat | Jan Řeháček</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600&family=Manrope:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#fafaf7;--text:#0f1115;--muted:#6b6b6b;--accent:#d4a574}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:Manrope,-apple-system,sans-serif;
     min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;line-height:1.6}
.karta{max-width:540px;text-align:center}
h1{font-family:Geist,sans-serif;font-size:clamp(26px,4vw,34px);font-weight:600;letter-spacing:-1px;margin-bottom:14px}
p{color:var(--muted);font-size:16px;margin-bottom:26px}
a.tel{display:inline-block;padding:11px 22px;border-radius:100px;background:var(--text);color:var(--bg);
  text-decoration:none;font-size:15px;font-weight:600;margin:0 6px 10px}
a.tel.vedlejsi{background:transparent;color:var(--text);border:1px solid rgba(15,17,21,.2)}
</style></head>
<body><div class="karta">
<h1>Zprávu se nepodařilo odeslat</h1>
<p>Formulář potřebuje zapnutý JavaScript a u Vás se nespustil, takže zpráva nedorazila.
Ozvěte se mi prosím napřímo — rád Vám odpovím.</p>
<a class="tel" href="tel:+420608177099">Zavolat +420 608 177 099</a>
<a class="tel vedlejsi" href="mailto:invest@janrehacek.com">invest@janrehacek.com</a>
</div></body></html>`;

module.exports = async (req, res) => {
    // `verze` slouží ke kontrole, že je nasazená očekávaná podoba funkce.
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ chyba: 'Použijte POST.', verze: 6 });
    }
    // S hlavičkou x-diagnostika vrátí odpověď i důvod, proč Resend zprávu odmítl.
    const diagnostika = Boolean(req.headers['x-diagnostika']);

    const data = await nactiTelo(req);
    const pole = {};
    for (const [k, max] of Object.entries(DELKY)) pole[k] = String(data[k] || '').trim().slice(0, max);

    const sito = await prosejPozadavek(req, data, () =>
        (!pole.name || !pole.message || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(pole.email))
            ? 'Vyplňte prosím jméno, platný e-mail a zprávu.'
            : null);
    if (!sito.prosel) {
        // Past na roboty odpovídá 200 {ok:true}, aby automatu neprozradila, že
        // neprošel. Jenže když formulář odešle ČLOVĚK, kterému se nespustil
        // JavaScript, prohlížeč na tu adresu přejde a člověk kouká na holý JSON
        // — a poptávka je přitom zahozená. Takovému návštěvníkovi proto radši
        // řekneme, co se stalo a kam zavolat.
        if (sito.tiche && jeNavigace(req)) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.status(200).end(STRANKA_BEZ_JS);
        }
        return res.status(sito.stav).json(sito.telo);
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
