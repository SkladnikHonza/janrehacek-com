# Fotky na stránce Rekonstrukce

Staženo z Pexels. Licence Pexels dovoluje komerční použití zdarma a nevyžaduje
uvádění autora; původ si vedeme kvůli dohledatelnosti, ne kvůli povinnosti.

| Soubor | Profese | Zdroj |
|---|---|---|
| `zednicke-prace.jpg` | Zednické práce a bourání | https://www.pexels.com/photo/36035072/ |
| `elektroinstalace.jpg` | Elektroinstalace | https://www.pexels.com/photo/36738243/ |
| `voda-topeni.jpg` | Voda, odpady a topení | https://www.pexels.com/photo/7664072/ |
| `koupelny.jpg` | Koupelny a WC na klíč | https://www.pexels.com/photo/6980656/ |
| `obklady-dlazby.jpg` | Obklady a dlažby | https://www.pexels.com/photo/11806490/ |
| `sadrokartony.jpg` | Sádrokartony a podhledy | https://www.pexels.com/photo/6474123/ |
| `podlahy.jpg` | Podlahy | https://www.pexels.com/photo/1388944/ |
| `malby-natery.jpg` | Malby a nátěry | https://www.pexels.com/photo/5583126/ |
| `kuchyne.jpg` | Kuchyně a truhlářské práce | https://www.pexels.com/photo/34993898/ |
| `okna-dvere.jpg` | Okna a dveře | https://www.pexels.com/photo/7195899/ |
| `fasady.jpg` | Čištění a obnova fasád | https://www.pexels.com/photo/30503925/ |

## Úprava

Fotky jsou oříznuté na 1600 × 1200 (4 : 3) a uložené jako progresivní JPEG, kvalita 84.

Barevně jsou převedené do **teplé černobílé**, aby ladily s paletou webu (krémová
#fafaf7 a okrová #d4a574). Barevné originály si navzájem neseděly — zelená kuchyň,
modré džíny, tyrkysový sádrokarton — a proti klidnému webu působily lacině.

Úprava odpovídá filtru `grayscale(1) sepia(.20) contrast(1.02) brightness(1.03)`,
ale je zapečená do souborů, ne dělaná v CSS: menší soubory a stejný výsledek
ve všech prohlížečích. Zapeklo se to tak, že se obrázek převede do šedé a na
každý kanál se pustí křivka s koeficientem 1,0702 (R), 1,0406 (G) a 0,9874 (B),
pak kontrast 1,02 a jas 1,03.

**Novou fotku je potřeba projet stejnou úpravou**, jinak v mřížce vyskočí.
