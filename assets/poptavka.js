/* Odeslání poptávky na /api/kontakt — sdílené kontaktní stránkou i detailem nabídky.
 *
 * Drív tenhle kód sedel natvrdo v contact.html. Jakmile pribyl formular primo
 * pod nabidkou, byly by z nej dve kopie, ktere se casem rozejdou — proto je
 * tady, generický: najde si na strance jakykoli formular mirici na /api/kontakt
 * a obslouzi ho. Zadne konkretni id, vsechno se hleda podle name= uvnitr
 * formulare, aby na jedne strance mohlo byt i vic formularu.
 *
 * Verejny klic Turnstile doplnuje build.js z promenne TURNSTILE_SITEKEY.
 * Dokud neni nastavena, dosadi se prazdny retezec, widget se vubec nenacte
 * a formular funguje dal, jen bez overeni.
 */
(function () {
  var TURNSTILE_KLIC = '__TURNSTILE_SITEKEY__';

  var tr = function (k, d) {
    var jazyk = (document.documentElement.lang || 'cs').split('-')[0];
    var slovnik = window.translations && window.translations[jazyk];
    return (slovnik && slovnik[k]) || d;
  };

  // Turnstile se nacita jednou za stranku, i kdyby formularu bylo vic.
  var turnstileZazadan = false;
  function zapniTurnstile(misto) {
    if (!misto || !/^0x[0-9A-Za-z]+$/.test(TURNSTILE_KLIC)) return;
    misto.hidden = false;
    misto.className = 'overeni cf-turnstile';
    misto.setAttribute('data-sitekey', TURNSTILE_KLIC);
    misto.setAttribute('data-language', (document.documentElement.lang || 'cs').split('-')[0]);
    if (turnstileZazadan) return;
    turnstileZazadan = true;
    var sk = document.createElement('script');
    sk.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    sk.async = true; sk.defer = true;
    document.head.appendChild(sk);
  }

  // Záchrana, když odesílání nefunguje: otevře e-mail s předvyplněnou zprávou,
  // aby se poptávka neztratila.
  function presEmail(data) {
    var radky = [
      'Jméno: ' + (data.get('name') || ''),
      'E-mail: ' + (data.get('email') || ''),
      'Telefon: ' + (data.get('phone') || '')
    ];
    if (data.get('interest')) radky.push('Zájem: ' + data.get('interest'));
    if (data.get('nabidka')) radky.push('Nabídka: ' + data.get('nabidka'));
    radky.push('', data.get('message') || '');
    location.href = 'mailto:invest@janrehacek.com?subject='
      + encodeURIComponent(data.get('subject') || 'Poptávka z janrehacek.com')
      + '&body=' + encodeURIComponent(radky.join('\n'));
    alert(tr('contact.mailto', 'Otevřel se Vám e-mail s předvyplněnou zprávou — stačí ho odeslat. Pokud se neotevřel, napište prosím přímo na invest@janrehacek.com.'));
  }

  // Na kontaktní stránce: doplnit nabídku, ze které člověk přišel.
  // Detail nabídky nic takového nepotřebuje — svůj název má vyplněný rovnou
  // z buildu, takže poptávka nese správnou nemovitost i bez sessionStorage.
  function doplnPosledniNabidku(form) {
    var poleNabidka = form.querySelector('[name="nabidka"]');
    var poleSubject = form.querySelector('[name="subject"]');
    var ctx = form.querySelector('.form-context');
    if (!poleNabidka || poleNabidka.value) return;   // detail nabídky už ji má
    try {
      var n = JSON.parse(sessionStorage.getItem('posledniNabidka') || 'null');
      var ref = document.referrer ? new URL(document.referrer) : null;
      if (!(n && ref && ref.origin === location.origin && ref.pathname.replace(/\/$/, '') === n.url)) return;
      poleNabidka.value = n.title + ' — ' + location.origin + n.url;
      if (poleSubject) poleSubject.value = 'Poptávka: ' + n.title;
      if (!ctx) return;
      var popisek = document.createElement('span');
      popisek.setAttribute('data-i18n', 'contact.about_listing');
      popisek.textContent = tr('contact.about_listing', 'Píšete k nabídce:');
      var nazev = document.createElement('strong');
      nazev.textContent = ' ' + n.title;
      ctx.appendChild(popisek);
      ctx.appendChild(nazev);
      ctx.hidden = false;
    } catch (e) {}
  }

  // /contact?zajem=rekonstrukce ze stránky Rekonstrukce rovnou předvybere
  // správnou položku, ať zájemce nemusí nic hledat v nabídce.
  function predvyberZajem(form) {
    try {
      if (new URLSearchParams(location.search).get('zajem') !== 'rekonstrukce') return;
      var sel = form.querySelector('[name="interest"]');
      var volba = sel && sel.querySelector('[data-i18n="form.opt6"]');
      if (volba) volba.selected = true;
      var predmet = form.querySelector('[name="subject"]');
      if (predmet) predmet.value = 'Poptávka: rekonstrukce';
    } catch (e) {}
  }

  // Formulare, ktere sbiraji vic nez jmeno a zpravu (treba odhad ceny), maji
  // svoje pole oznacena data-souhrn="Popisek". API bere jen pevnou sadu poli,
  // takze se tohle pred odeslanim slozi do zpravy — jinak by se to na server
  // vubec nedostalo a kvuli kazdemu novemu formulari by se musela menit
  // kontaktni funkce.
  function slozSouhrn(form) {
    var cil = form.querySelector('[data-souhrn-cil]');
    if (!cil) return;
    var pole = form.querySelectorAll('[data-souhrn]');
    if (!pole.length) return;
    var radky = [];
    for (var i = 0; i < pole.length; i++) {
      var hodnota = String(pole[i].value || '').trim();
      if (!hodnota) continue;
      radky.push(pole[i].getAttribute('data-souhrn') + ': ' + hodnota);
    }
    if (!radky.length) return;
    // Poznamka uzivatele zustava pod souhrnem. Pri opakovanem odeslani
    // (treba po chybe) se souhrn nesmi nalepit dvakrat.
    var poznamka = String(cil.value || '').trim();
    var deli = '\n\n— — —\n';
    var kus = poznamka.indexOf(deli);
    if (kus !== -1) poznamka = poznamka.slice(kus + deli.length).trim();
    cil.value = radky.join('\n') + (poznamka ? deli + poznamka : '');

    // Do predmetu e-mailu jeste strucne, o co jde — v doruc. poste je pak
    // poznat „Odhad ceny: Byt 3+1, 75 m², Ostrava" od desitky stejnych radku.
    var predmet = form.querySelector('[name="subject"][data-predmet-zaklad]');
    if (!predmet) return;
    var kusy = [];
    var vybrane = form.querySelectorAll('[data-predmet]');
    for (var j = 0; j < vybrane.length; j++) {
      var h = String(vybrane[j].value || '').trim();
      if (h) kusy.push(vybrane[j].getAttribute('data-predmet').replace('{}', h));
    }
    predmet.value = predmet.getAttribute('data-predmet-zaklad')
      + (kusy.length ? ': ' + kusy.join(', ') : '');
  }

  function obsluz(form) {
    var nacteno = Date.now();
    zapniTurnstile(form.querySelector('.overeni'));

    var odkud = form.querySelector('[name="odkud"]');
    if (odkud && !odkud.value) odkud.value = document.referrer || '';

    predvyberZajem(form);
    doplnPosledniNabidku(form);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      slozSouhrn(form);
      var mereni = form.querySelector('[name="trvani"]');
      if (mereni) mereni.value = String(Date.now() - nacteno);
      var data = new FormData(form);
      var btn = form.querySelector('button[type="submit"]');
      var original = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '…'; }
      var hotovo = function () { if (btn) { btn.disabled = false; btn.textContent = original; } };

      fetch(form.getAttribute('action'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(data)),
      }).then(function (r) {
        // 503 = na serveru zatím chybí klíč nebo databáze; 404 = adresa neexistuje.
        // U kontaktních formulářů se poptávka zachrání otevřením e-mailu —
        // u přihlášky k hlídacímu psovi by z toho byla zmatená prázdná zpráva,
        // takže ta si řekne data-bez-zalohy a dostane obyčejnou hlášku.
        if (r.status === 503 || r.status === 404) {
          hotovo();
          if (form.hasAttribute('data-bez-zalohy')) {
            return r.json().catch(function () { return null; }).then(function (json) {
              alert(json && json.chyba ? json.chyba
                : tr('contact.error', 'Zprávu se nepodařilo odeslat. Zkuste to prosím znovu nebo napište přímo na invest@janrehacek.com.'));
            });
          }
          presEmail(data);
          return;
        }
        return r.json().then(function (json) {
          // Vlastní stránka s poděkováním → odeslané poptávky jdou spočítat
          // v analytice. Formulář s data-uspech místo toho poděkuje na místě.
          if (r.ok && json && json.ok) {
            var text = form.getAttribute('data-uspech');
            if (!text) { location.href = '/dekuji'; return; }
            var hotovoBox = document.createElement('p');
            hotovoBox.className = 'form-hotovo';
            hotovoBox.setAttribute('role', 'status');
            hotovoBox.textContent = tr(form.getAttribute('data-uspech-klic') || '', text);
            form.parentNode.replaceChild(hotovoBox, form);
            return;
          }
          hotovo();
          // Token Turnstile je jednorázový — po neúspěchu se musí vyrobit nový,
          // jinak by druhý pokus skončil stejně.
          if (window.turnstile) { try { window.turnstile.reset(); } catch (e) {} }
          alert(json && json.chyba ? json.chyba : tr('contact.error', 'Zprávu se nepodařilo odeslat. Zkuste to prosím znovu nebo napište přímo na invest@janrehacek.com.'));
        });
      }).catch(function () { hotovo(); presEmail(data); });
    });
  }

  var formulare = document.querySelectorAll('form[action^="/api/"]');
  for (var i = 0; i < formulare.length; i++) obsluz(formulare[i]);
})();
