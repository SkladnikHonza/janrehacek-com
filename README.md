# janrehacek.com

Osobní web Jana Řeháčka — investor, realitní expert, zakladatel platformy Housio.

## Struktura souborů

```
/
├── index.html          # Hlavní stránka (vše v jednom souboru)
├── images/
│   └── jan-rehacek.jpg # Profilová fotka
├── vercel.json         # Konfigurace pro Vercel
├── robots.txt          # SEO - pro vyhledávače
└── sitemap.xml         # SEO - mapa stránek
```

## Jak nasadit na Vercel

1. Přihlas se na https://vercel.com (přes GitHub nebo email)
2. Klikni na "Add New..." → "Project"
3. Vyber "Import" → nahraj celou složku jako ZIP nebo přes GitHub
4. Vercel automaticky detekuje statický web → klikni "Deploy"
5. Hotovo. Web pojede na adrese typu: `janrehacek-xyz.vercel.app`

## Jak nastavit doménu janrehacek.com

### Ve Vercel:
1. Settings → Domains → Add → `janrehacek.com`
2. Vercel ti ukáže konkrétní DNS záznamy

### Ve Webglobe (správa DNS):
Nastav tyto A/CNAME záznamy podle pokynů Vercelu:

- `A` záznam: `@` → `76.76.21.21`
- `CNAME` záznam: `www` → `cname.vercel-dns.com`

DNS propagace trvá obvykle 5 minut až 24 hodin.

## Jak upravit obsah

- **Text**: Otevři `index.html` v editoru (VS Code, Sublime, atd.) a edituj
- **Překlady**: Najdi v `index.html` sekci `window.translations.cs` (a další jazyky)
- **Fotka**: Nahraď soubor `images/jan-rehacek.jpg`
- **Po úpravě**: nahraj znovu na Vercel (přetáhni soubory nebo přes Git)

## Funkce stránky

- 11 jazyků: CZ, SK, EN, DE, FR, IT, ES, PL, RU, JA, ZH
- Auto-detekce jazyka prohlížeče
- Responzivní design (mobil, tablet, desktop)
- SEO optimalizace (sitemap, robots.txt, hreflang)
- Plně statická — žádný backend nepotřebuje

---

© 2026 Jan Řeháček
