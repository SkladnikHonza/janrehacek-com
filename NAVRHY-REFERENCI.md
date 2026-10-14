# Návrhy referencí k odsouhlasení klientem

**Tyhle texty NEPATŘÍ na web, dokud je konkrétní klient neodsouhlasí.**
Vymyšlená recenze je podle zákona č. 634/1992 Sb. o ochraně spotřebitele
nekalá obchodní praktika „za všech okolností" — tedy zakázaná bez ohledu
na to, jestli někomu uškodila.

Postup: pošli klientovi zprávu ve stylu *„Píšu na web reference. Napsal
jsem, jak si naši spolupráci pamatuju — můžu to tam dát pod tvým jménem?
Klidně to přepiš."* Jeho odpověď si ulož. Pak stačí říct, kdo co schválil,
a doplní se to na /references.

Čísla doplň podle skutečnosti — reference s číslem je mnohem silnější,
ale musí sedět.

---

## 1. Prodej nemovitosti

> „Byt po rodičích jsem zkoušel prodat sám a půl roku se nic nedělo. Honza
> přišel s jinou cenou, než jsem měl v hlavě, a vysvětlil mi proč. Prodáno
> bylo za pár týdnů a o papíry ani o katastr jsem se nestaral. Hlavně mi ale
> od začátku říkal věci na rovinu, i když se mi nelíbily."

*Komu: klientovi, kterému jsi prodal byt nebo dům.*
*Číslo k doplnění: za kolik týdnů se prodalo.*

## 2. Pomoc s hypotékou

> „Nejhorší na koupi bytu nebyl byt, ale hypotéka. Honza mi vysvětlil, co po
> mně banka bude chtít a co si mám připravit dopředu. Vyřizování pak šlo bez
> zdržení a já aspoň chápal, co podepisuju."

*Komu: kupujícímu, kterému jsi poradil s financováním.*

## 3. Lepší sazba

> „Měl jsem nabídku od své banky a bral jsem ji jako danou. Honza mi doporučil
> zkusit ještě jiné a výsledná sazba byla citelně nižší. Na dvacet let je to
> rozdíl, který se těžko přehlíží."

*Komu: klientovi, kterému jsi vyjednal výhodnější podmínky.*
*Číslo k doplnění: o kolik procentního bodu níž.*


---

# Zprávy k odeslání — stačí zkopírovat

Pošli e-mailem nebo přes WhatsApp. Odpověď („jo, klidně") si nech —
je to doklad souhlasu. Pak napiš Claudovi, kdo co schválil, a doplní se to
na /references i s hvězdičkami.

## Komu jsi prodal nemovitost

> Dobrý den [jméno],
>
> dávám dohromady reference na web a rád bych tam měl i naši spolupráci.
> Zkusil jsem napsat, jak si ji pamatuju já — můžu to zveřejnit pod Vaším
> jménem? Klidně to přepište vlastními slovy, bude to tak lepší.
>
> „Byt po rodičích jsem zkoušel prodat sám a půl roku se nic nedělo. Honza
> přišel s jinou cenou, než jsem měl v hlavě, a vysvětlil mi proč. Prodáno
> bylo za pár týdnů a o papíry ani o katastr jsem se nestaral. Hlavně mi ale
> od začátku říkal věci na rovinu, i když se mi nelíbily."
>
> A ještě jedna otázka: kolik hvězdiček byste mi dal z pěti?
>
> Díky, Jan Řeháček

## Komu jsi poradil s hypotékou

> Dobrý den [jméno],
>
> dávám dohromady reference na web. Zkusil jsem napsat, jak si naši
> spolupráci pamatuju — můžu to zveřejnit pod Vaším jménem? Klidně to
> upravte.
>
> „Nejhorší na koupi bytu nebyl byt, ale hypotéka. Honza mi vysvětlil, co po
> mně banka bude chtít, a co si mám připravit dopředu. Vyřizování pak šlo bez
> zdržení a já aspoň chápal, co podepisuju."
>
> A kolik hvězdiček byste mi dal z pěti?
>
> Díky, Jan Řeháček

## Komu jsi vyjednal lepší sazbu

> Dobrý den [jméno],
>
> dávám dohromady reference na web. Napsal jsem, jak si naši spolupráci
> pamatuju — můžu to dát na web pod Vaším jménem? Klidně přepište.
>
> „Měl jsem nabídku od své banky a bral jsem ji jako danou. Honza mi
> doporučil zkusit ještě jiné a výsledná sazba byla citelně nižší. Na dvacet
> let je to rozdíl, který se těžko přehlíží."
>
> Kdyžtak doplňte, o kolik ta sazba vyšla níž — číslo tomu dodá váhu.
> A kolik hvězdiček byste mi dal z pěti?
>
> Díky, Jan Řeháček

---

# Jak to pak doplnit na web

Reference jsou v `references.html` v bloku `.testimonials-grid`.
Jedna vypadá takhle:

```html
<div class="testimonial">
    <div class="testimonial-stars">★★★★★</div>
    <div class="testimonial-quote" data-i18n="testimonials.q5">"…text…"</div>
    <div class="testimonial-author">
        <div class="testimonial-avatar">JN</div>
        <div>
            <div class="testimonial-name">Jan Novák</div>
            <div class="testimonial-role" data-i18n="testimonials.r5">Prodej bytu, Ostrava 2026</div>
        </div>
    </div>
</div>
```

Klíče `testimonials.q5` / `.r5` je potřeba doplnit do `assets/script.js`
do všech jedenácti jazyků, jinak zůstanou česky.
