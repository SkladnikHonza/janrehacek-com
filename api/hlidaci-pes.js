// Hlídací pes — zájemce si nechá říct, až přijde nabídka, která mu sedne.
//
// PROČ TO EXISTUJE: na webu bývají jednotky aktivních nabídek. Drtivá většina
// návštěvníků mezi nimi nenajde to svoje a odejde — a když se za tři týdny
// objeví přesně to, co hledali, není komu napsat. Tohle z prohrané návštěvy
// udělá kontakt, a navíc kontakt, který sám řekl, co kupuje.
//
// Proměnné prostředí (Vercel → Settings → Environment Variables):
//   SUPABASE_URL           adresa projektu
//   SUPABASE_SERVICE_KEY   servisní klíč (obchází RLS, nikdy nepatří do repozitáře)
//   ODHLASENI_TAJEMSTVI    klíč k podpisu odhlašovacích odkazů
//   RESEND_API_KEY         odesílání potvrzení; bez něj se zápis uloží a jen
//                          se nepošle e-mail — kontakt se tím neztratí
//   KONTAKT_PRIJEMCE       kam chodí upozornění pro makléře
//
// POST /api/hlidaci-pes
// Odpovědi: 200 {ok:true} · 400 chybný vstup · 403 mimo web · 429 moc často ·
//           503 {kod:'bez-databaze'} když chybí přístup k Supabase

const { escapeHtml, nactiTelo, prosejPozadavek } = require('../lib/ochrana');
const { odhlasovaciOdkaz } = require('../lib/odhlaseni');

const PRIJEMCI = (process.env.KONTAKT_PRIJEMCE || 'invest@janrehacek.com')
    .split(',').map((a) => a.trim()).filter(Boolean);
const ODESILATEL = process.env.KONTAKT_ODESILATEL || 'Jan Řeháček <formular@housio.app>';

const DELKY = { email: 160, typ: 40, lokalita: 160, dispozice: 40, poznamka: 1000 };
const TYPY = new Set(['byt', 'dum', 'pozemek', 'komercni', 'cokoli']);

const NAZEV_TYPU = {
    byt: 'Byt', dum: 'Dům', pozemek: 'Pozemek',
    komercni: 'Komerční prostor', cokoli: 'Cokoli zajímavého',
};

async function uloz(zaznam) {
    const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
    const klic = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !klic) return { ok: false, kod: 'bez-databaze' };
    // Druhé přihlášení té samé adresy přepíše kritéria místo toho, aby spadlo
    // na duplicitě — člověk si tak může zadání kdykoli upravit znovu přes web.
    const odpoved = await fetch(`${url}/rest/v1/hlidaci_pes?on_conflict=email`, {
        method: 'POST',
        headers: {
            apikey: klic,
            Authorization: `Bearer ${klic}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify([zaznam]),
    });
    if (!odpoved.ok) {
        const detail = (await odpoved.text()).slice(0, 300);
        console.error('Supabase odmítl zápis hlídacího psa:', odpoved.status, detail);
        return { ok: false, kod: 'zapis-selhal' };
    }
    return { ok: true };
}

async function posli({ to, subject, html, text, listUnsubscribe }) {
    const klic = process.env.RESEND_API_KEY;
    if (!klic) return false;
    const hlavicky = listUnsubscribe ? { 'List-Unsubscribe': `<${listUnsubscribe}>` } : undefined;
    try {
        const odp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${klic}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: ODESILATEL, to, subject, html, text, headers: hlavicky }),
        });
        if (!odp.ok) console.error('Resend odmítl zprávu hlídacího psa:', odp.status, (await odp.text()).slice(0, 200));
        return odp.ok;
    } catch (e) {
        console.error('Resend nedostupný:', e.message);
        return false;
    }
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ chyba: 'Použijte POST.' });
    }

    const data = await nactiTelo(req);
    const pole = {};
    for (const [k, max] of Object.entries(DELKY)) pole[k] = String(data[k] || '').trim().slice(0, max);
    pole.email = pole.email.toLowerCase();
    const cenaDo = Number(String(data.cena_do || '').replace(/\s/g, '')) || null;

    const sito = await prosejPozadavek(req, data, () => {
        if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(pole.email)) return 'Zadejte prosím platný e-mail.';
        if (!TYPY.has(pole.typ)) return 'Vyberte prosím, co hledáte.';
        if (!pole.lokalita) return 'Napište prosím, kde hledáte.';
        if (!String(data.souhlas || '').trim()) return 'Bez souhlasu se zpracováním e-mailu Vám bohužel psát nemůžu.';
        return null;
    });
    if (!sito.prosel) return res.status(sito.stav).json(sito.telo);

    const ulozeno = await uloz({
        email: pole.email,
        typ: pole.typ,
        lokalita: pole.lokalita,
        dispozice: pole.dispozice || null,
        cena_do: cenaDo,
        poznamka: pole.poznamka || null,
        aktivni: true,
        // Souhlas musí jít doložit: kdy, odkud a z jaké adresy přišel.
        souhlas_kdy: new Date().toISOString(),
        souhlas_ip: sito.ip,
        zdroj: String(data.odkud || '').slice(0, 300) || null,
    });
    if (!ulozeno.ok) {
        return res.status(503).json({
            kod: ulozeno.kod,
            chyba: 'Přihlášení se teď nepodařilo uložit. Zkuste to prosím za chvíli nebo mi napište na invest@janrehacek.com.',
        });
    }

    const popis = [
        NAZEV_TYPU[pole.typ] || pole.typ,
        pole.dispozice,
        pole.lokalita,
        cenaDo ? `do ${cenaDo.toLocaleString('cs-CZ')} Kč` : '',
    ].filter(Boolean).join(' · ');

    const odhlasit = odhlasovaciOdkaz(pole.email, 'pes');

    // Potvrzení zájemci — ať ví, co si zapsal, a má po ruce odhlášení.
    await posli({
        to: [pole.email],
        subject: 'Hlídám za Vás nabídky — Jan Řeháček',
        text: `Dobrý den,\n\nzapsal jsem si, co hledáte:\n${popis}\n\n`
            + `Jakmile vezmu do nabídky něco, co tomu odpovídá, ozvu se Vám. Často dřív, než se to objeví na realitních serverech.\n\n`
            + `Když už hledat nebudete, stačí kliknout sem a přestanu psát:\n${odhlasit || '(odhlašovací odkaz se nepodařilo vytvořit — napište mi na invest@janrehacek.com)'}\n\n`
            + `Jan Řeháček\n+420 608 177 099\ninvest@janrehacek.com`,
        html: `<div style="font:15px/1.7 -apple-system,Segoe UI,sans-serif;color:#0f1115">
<p>Dobrý den,</p>
<p>zapsal jsem si, co hledáte:</p>
<p style="padding:12px 16px;background:#faf6f0;border-left:3px solid #d4a574"><strong>${escapeHtml(popis)}</strong></p>
<p>Jakmile vezmu do nabídky něco, co tomu odpovídá, ozvu se Vám. Často dřív, než se to objeví na realitních serverech.</p>
<p style="color:#6b6b6b;font-size:13px">Když už hledat nebudete, stačí ${odhlasit ? `<a href="${odhlasit}">kliknout sem</a>` : 'mi napsat'} a přestanu psát.</p>
<hr style="border:0;border-top:1px solid #e5e5e5;margin:20px 0">
<p style="color:#6b6b6b;font-size:13px">Jan Řeháček · +420 608 177 099 · invest@janrehacek.com</p>
</div>`,
        listUnsubscribe: odhlasit || undefined,
    });

    // Upozornění pro makléře.
    await posli({
        to: PRIJEMCI,
        subject: `Hlídací pes: ${popis}`,
        text: `${pole.email}\n${popis}\n\n${pole.poznamka || ''}`,
        html: `<div style="font:15px/1.7 -apple-system,Segoe UI,sans-serif">
<p><strong>${escapeHtml(pole.email)}</strong></p>
<p>${escapeHtml(popis)}</p>
${pole.poznamka ? `<p style="white-space:pre-wrap">${escapeHtml(pole.poznamka)}</p>` : ''}
</div>`,
    });

    return res.status(200).json({ ok: true });
};
