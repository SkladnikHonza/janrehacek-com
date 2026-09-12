// Kontaktní formulář → e-mail přes Resend.
//
// Klíč NIKDY nepatří do repozitáře (je veřejný) — je v proměnných prostředí projektu
// na Vercelu: Settings → Environment Variables.
//   RESEND_API_KEY       povinné, klíč z resend.com (Sending access)
//   KONTAKT_PRIJEMCE     nepovinné, kam poptávky chodí (výchozí invest@janrehacek.com)
//   KONTAKT_ODESILATEL   nepovinné, „Jméno <adresa>“; doména MUSÍ být v Resendu ověřená
//
// POST /api/kontakt — přijme JSON i klasické odeslání formuláře (bez JavaScriptu).
// Odpovědi: 200 {ok:true} · 303 na /dekuji (bez JS) · 400 chybný vstup ·
//           429 příliš mnoho zpráv · 503 {kod:'bez-klice'} → web nabídne e-mail.

const PRIJEMCE = process.env.KONTAKT_PRIJEMCE || 'invest@janrehacek.com';
const ODESILATEL = process.env.KONTAKT_ODESILATEL || 'Formulář janrehacek.com <formular@housio.app>';

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
        return res.status(405).json({ chyba: 'Použijte POST.', verze: 2 });
    }
    // S hlavičkou x-diagnostika vrátí odpověď i důvod, proč Resend zprávu odmítl.
    const diagnostika = Boolean(req.headers['x-diagnostika']);

    const data = await nactiTelo(req);
    const pole = {};
    for (const [k, max] of Object.entries(DELKY)) pole[k] = String(data[k] || '').trim().slice(0, max);

    // Past na roboty: pole je v HTML skryté, člověk ho nevyplní.
    if (String(data.botcheck || '').trim()) return res.status(200).json({ ok: true });

    if (!pole.name || !pole.message || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(pole.email)) {
        return res.status(400).json({ chyba: 'Vyplňte prosím jméno, platný e-mail a zprávu.' });
    }

    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'neznama';
    if (prilisCasto(ip)) return res.status(429).json({ chyba: 'Zpráv z jedné adresy je příliš mnoho. Zkuste to prosím za chvíli.' });

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
                to: [PRIJEMCE],
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
