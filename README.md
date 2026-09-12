# janrehacek.com

Osobní web Jana Řeháčka — investor, realitní expert, zakladatel platformy Housio.
Statický web bez backendu, nasazený na Vercelu.

**Repozitář je veřejný.** Nepatří sem osobní údaje, seznamy kontaktů, hesla ani klíče.

## Struktura

```
/
├── index.html, about.html, services.html, references.html,
│   contact.html, housio.html, pro-maklere.html   # ručně psané stránky
├── 404.html, dekuji.html        # chybová stránka a poděkování po odeslání formuláře
├── assets/
│   ├── styles.css
│   ├── script.js                # logika webu + překlady (11 jazyků)
│   └── listings-i18n.js         # překlady textů nabídek (viz níže)
├── images/listings/{pronajem,prodej,investicni}/<slug>/
│   ├── info.md                  # data nabídky (YAML hlavička + Markdown)
│   ├── 01-uvodni.jpg …          # fotky; titulní se jmenuje 01-uvodni.*
│   └── _nahled/                 # zmenšené verze fotek pro karty a galerii
├── _templates/                  # šablony pro build.js
├── build.js                     # generátor nabídek, sitemapy a složky dist/
└── vercel.json
```

## Jak se web staví

`node build.js`:

1. z `info.md` a `_templates/` vygeneruje `nabidka/` a `investors/` a karty
   nabídek na hlavní stránce (mezi značkami `NABIDKY:START` a `NABIDKY:END`),
2. vytvoří `sitemap.xml`,
3. do `dist/` zkopíruje jen veřejné soubory (bez README, build.js, šablon
   a `info.md`) a k odkazům na CSS, JS a fotky přidá `?v=<otisk>`, takže
   prohlížeče můžou soubory držet dlouho v cache a po změně si stáhnou novou verzi.

Vercel spouští totéž a servíruje složku `dist/`. Po změně nabídky nebo šablony
pusť `node build.js` i lokálně před commitem, ať repozitář odpovídá webu.
Vygenerované stránky v `nabidka/` a `investors/` ručně neupravuj — build je přepíše.

Build skončí chybou, když v `info.md` chybí povinné pole nebo je tam neznámý
nadpis sekce — radši neprojde, než aby na webu zmizela cena nebo popis.

## Nová nebo upravená nabídka

1. Složka `images/listings/<typ>/<slug>/` s `info.md` a fotkami. Fotky nahrávej
   zmenšené (do ~400 kB), nikdy originál z fotoaparátu — zůstal by navždy v historii.
2. Zmenšené verze do `_nahled/` se dělají lokálně na Macu (nástroj `sips`, postup
   je popsaný v `build.js`). Když chybí, web použije originál.
3. **Překlady:** `assets/listings-i18n.js` se negeneruje. Překlady nových nebo
   změněných textů (klíče `L.<typ>.<slug>.*` a `T.<český text>`) je potřeba doplnit
   ručně nebo je nechat přeložit AI. `node build.js` na konci vypíše klíče,
   kterým překlad chybí.
4. Když nabídka zmizí nebo se přejmenuje, přidej do `vercel.json` → `redirects`
   přesměrování ze staré adresy (jinak lidé z Googlu skončí na 404).

## Doména a DNS

DNS je u Webglobe. Hodnoty záznamů ber vždy z Vercel → projekt → Settings →
Domains, neopisuj je odsud — Vercel je občas mění.

## Kontaktní formulář

Formulář posílá zprávu na `/api/kontakt` (soubor `api/kontakt.js`), který ji přes
Resend odešle na invest@janrehacek.com a jako adresu pro odpověď nastaví zájemce.
Po úspěšném odeslání web přejde na `/dekuji`.

Klíč **nikdy nepatří do repozitáře** — je veřejný. Nastavuje se ve Vercelu
(projekt → Settings → Environment Variables):

- `RESEND_API_KEY` — povinné, klíč z resend.com
- `KONTAKT_PRIJEMCE` — nepovinné, kam poptávky chodí
- `KONTAKT_ODESILATEL` — nepovinné, „Jméno <adresa>“; doména musí být v Resendu ověřená

Dokud klíč chybí, vrátí `/api/kontakt` stav 503 a formulář otevře e-mail
s předvyplněnou zprávou, takže se poptávka neztratí.

## Jazyky

11 jazyků (CZ, SK, EN, DE, FR, IT, ES, PL, RU, JA, ZH) se přepíná v prohlížeči
a každá stránka má jednu adresu. Vyhledávače proto vidí jen češtinu —
samostatné jazykové adresy (hreflang) web zatím nemá.

---

© 2026 Jan Řeháček
