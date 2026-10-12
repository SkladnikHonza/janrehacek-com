// Odhlášení z rozesílky CRM.
//
// Odkaz na tuhle adresu nosí každá zpráva z kampaně v hlavičce List-Unsubscribe,
// takže Gmail i Seznam nabídnou tlačítko Odhlásit, aniž by v textu byl jediný odkaz.
//
// Zápis jde do Supabase, tabulka `zakazane`. Lokální CRM si ho stáhne skriptem
// cloud/stahni-rucni.js při dalším nahrávání a rozesílací modul na tu adresu
// už nikdy nesmí napsat.
//
// Proměnné prostředí (Vercel → Settings → Environment Variables):
//   SUPABASE_URL           adresa projektu
//   SUPABASE_SERVICE_KEY   servisní klíč (obchází RLS, nikdy nepatří do repozitáře)
//   ODHLASENI_TAJEMSTVI    stejný řetězec jako v CRM, jinak nebude sedět podpis
//
// GET   — člověk klikl na odkaz, ukáže se potvrzovací stránka
// POST  — odhlášení na jedno kliknutí přímo z Gmailu (List-Unsubscribe-Post)

const { adresaZOdkazu, platnySeznam } = require('../lib/odhlaseni');

async function supabase(cesta, telo, metoda = 'POST') {
    const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
    const klic = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !klic) throw new Error('Chybí SUPABASE_URL nebo SUPABASE_SERVICE_KEY.');
    const odpoved = await fetch(`${url}/rest/v1/${cesta}`, {
        method: metoda,
        headers: {
            apikey: klic,
            Authorization: `Bearer ${klic}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(telo),
    });
    if (!odpoved.ok) throw new Error(`Supabase ${odpoved.status}: ${(await odpoved.text()).slice(0, 200)}`);
}

// Rozesílka z CRM a hlídací pes jsou dva různé seznamy. Odhlášení z jednoho
// nesmí tiše vypnout druhý — kdo si nechá hlídat nabídky, nechce tím říct,
// že už nikdy nechce slyšet o ničem jiném, a naopak.
async function zapis(email, seznam) {
    if (seznam === 'pes') {
        return supabase(`hlidaci_pes?email=eq.${encodeURIComponent(email)}`,
            { aktivni: false, odhlaseno_kdy: new Date().toISOString() }, 'PATCH');
    }
    return supabase('zakazane?on_conflict=email',
        [{ email, duvod: 'odhlášení z e-mailu', kdy: new Date().toISOString() }]);
}

const STRANKA = (nadpis, text) => `<!DOCTYPE html>
<html lang="cs"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${nadpis} | Jan Řeháček</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600&family=Manrope:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#fafaf7;--text:#0f1115;--muted:#6b6b6b;--accent:#d4a574}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:Manrope,-apple-system,sans-serif;
     min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;line-height:1.6}
.karta{max-width:520px;text-align:center}
h1{font-family:Geist,sans-serif;font-size:clamp(26px,4vw,34px);font-weight:600;letter-spacing:-1px;margin-bottom:14px}
p{color:var(--muted);font-size:16px;margin-bottom:26px}
a{display:inline-block;padding:11px 22px;border-radius:100px;background:var(--text);color:var(--bg);
  text-decoration:none;font-size:14px;font-weight:500}
a:hover{background:var(--accent);color:var(--text)}
</style></head>
<body><div class="karta"><h1>${nadpis}</h1><p>${text}</p>
<a href="https://www.janrehacek.com/">Zpět na janrehacek.com</a></div></body></html>`;

module.exports = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return res.status(405).end('Použijte GET nebo POST.');
    }
    const dotaz = new URL(req.url, 'http://localhost').searchParams;
    const email = adresaZOdkazu(dotaz.get('e'), dotaz.get('p'));
    const seznam = platnySeznam(dotaz.get('s'));

    // Jednokliknutí z Gmailu — odpověď nikdo nečte, stačí stavový kód.
    const jenStav = req.method === 'POST';

    if (!email) {
        if (jenStav) return res.status(400).end('Neplatný odkaz.');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(400).end(STRANKA('Odkaz není platný',
            'Zkuste prosím kliknout na odhlášení přímo ve zprávě, nebo mi napište na invest@janrehacek.com a vyřadím Vás ručně.'));
    }

    try {
        await zapis(email, seznam);
    } catch (e) {
        console.error('Odhlášení se nepodařilo zapsat:', e.message);
        if (jenStav) return res.status(500).end('Nepodařilo se uložit.');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(500).end(STRANKA('Něco se nepovedlo',
            'Odhlášení se teď nepodařilo uložit. Napište mi prosím na invest@janrehacek.com a vyřadím Vás ručně.'));
    }

    if (jenStav) return res.status(200).end('OK');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const bezpecny = email.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return res.status(200).end(seznam === 'pes'
        ? STRANKA('Hotovo, nabídky už hlídat nebudu',
            `Adresu <strong>${bezpecny}</strong> jsem z hlídacího psa vyřadil. O nových nabídkách Vám psát nebudu.`)
        : STRANKA('Hotovo, už se neozvu',
            `Adresu <strong>${bezpecny}</strong> jsem vyřadil ze seznamu. Žádnou další zprávu Vám neposílám.`));
};
