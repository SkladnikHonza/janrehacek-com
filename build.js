#!/usr/bin/env node
/**
 * build.js — file-based listings generator (categorized: pronajem / prodej)
 *
 * Folder structure: images/listings/{type}/{slug}/
 *   - info.md       YAML frontmatter + Markdown body
 *   - 01-uvodni.jpg cover photo (preferred name)
 *   - 01.jpg ...    additional gallery photos
 *
 * Cover lookup order:
 *   1) 01-uvodni.jpg (or .png / .webp)
 *   2) first alphabetically sorted image — with warning
 *
 * Gallery = ALL image files in the folder (including the cover).
 *
 * Generates:
 *   - nabidka/index.html                       all listings (filter: null)
 *   - nabidka/pronajem/index.html              rental listings
 *   - nabidka/prodej/index.html                sale listings
 *   - nabidka/{type}/{slug}/index.html         detail page per listing
 *   - sitemap.xml                              static + dynamic routes
 *
 * Zero npm dependencies. Run: `node build.js`
 */

const fs = require('fs');
const path = require('path');

// ===== CONFIG =====
const ROOT = __dirname;
const LISTINGS_DIR = path.join(ROOT, 'images', 'listings');
const TEMPLATES_DIR = path.join(ROOT, '_templates');
const OUTPUT_DIR = path.join(ROOT, 'nabidka');
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');
const SITE_URL = 'https://janrehacek.com';

const TYPES = ['pronajem', 'prodej', 'investicni'];   // recognized listing categories
const IMG_EXT = /\.(jpe?g|png|webp)$/i;
const COVER_NAME = /^01-uvodni\.(jpe?g|png|webp)$/i;

const STATIC_ROUTES = [
    { loc: '/',           priority: '1.0', changefreq: 'monthly' },
    { loc: '/about',      priority: '0.8', changefreq: 'monthly' },
    { loc: '/services',   priority: '0.9', changefreq: 'monthly' },
    { loc: '/investors',  priority: '0.9', changefreq: 'weekly' },
    { loc: '/references', priority: '0.7', changefreq: 'monthly' },
    { loc: '/nabidka',    priority: '0.9', changefreq: 'weekly' },
    { loc: '/contact',    priority: '0.9', changefreq: 'monthly' },
];

// Per-type output configuration for DETAIL pages.
//   outputBase — path under ROOT where `{slug}/index.html` lives
//   base       — relative `../` prefix from that index.html back to ROOT
//   template   — which template file in _templates/ to use
const DETAIL_OUTPUT = {
    pronajem:   { outputBase: 'nabidka/pronajem', base: '../../../', template: 'listing-detail.html' },
    prodej:     { outputBase: 'nabidka/prodej',   base: '../../../', template: 'listing-detail.html' },
    investicni: { outputBase: 'investors',         base: '../../',    template: 'listing-detail-investor.html' },
};

// Index pages to generate (each filters listings by type or shows all).
//   outputBase — path under ROOT where `index.html` lives (no trailing /)
//   depth      — number of `../` to reach ROOT
//   filter     — null = all 'nabidka' types; ['investicni'] = single-type
//   template   — listing-index.html (nabidka grid) | investors-landing.html
//   typeUrl    — absolute URL the cards on this page link into
const INDEX_PAGES = [
    { outputBase: 'nabidka',          depth: 1, filter: null,       tab: 'vse',      template: 'listing-index.html',     typeUrlBase: '/nabidka',  eyebrow_key: 'listings.eyebrow.all',  h1_key: 'listings.h1.all',  eyebrow: 'Nabídka nemovitostí',  h1: 'Aktuální nabídka <em>nemovitostí.</em>' },
    { outputBase: 'nabidka/pronajem', depth: 2, filter: 'pronajem', tab: 'pronajem', template: 'listing-index.html',     typeUrlBase: '/nabidka',  eyebrow_key: 'listings.eyebrow.rent', h1_key: 'listings.h1.rent', eyebrow: 'Pronájem nemovitostí', h1: 'Aktuální <em>pronájmy.</em>' },
    { outputBase: 'nabidka/prodej',   depth: 2, filter: 'prodej',   tab: 'prodej',   template: 'listing-index.html',     typeUrlBase: '/nabidka',  eyebrow_key: 'listings.eyebrow.sale', h1_key: 'listings.h1.sale', eyebrow: 'Prodej nemovitostí',   h1: 'Aktuální nabídka <em>k prodeji.</em>' },
    { outputBase: 'investors',        depth: 1, filter: 'investicni', tab: null,     template: 'investors-landing.html', typeUrlBase: '/investors', eyebrow_key: 'listing.investicni.eyebrow', h1_key: 'listing.investicni.heading', eyebrow: 'INVESTIČNÍ PŘÍLEŽITOSTI', h1: 'Investiční příležitosti pro vážné <em>investory.</em>' },
];

// Card badge type label (CZ default; i18n keys: listings.type.{rent,sale,invest})
const TYPE_LABEL = { pronajem: 'PRONÁJEM', prodej: 'PRODEJ',     investicni: 'INVESTICE' };
const TYPE_I18N  = { pronajem: 'listings.type.rent', prodej: 'listings.type.sale', investicni: 'listings.type.invest' };

// Status sorting + presentation
const STATUS_ORDER = ['nova', 'aktivni', 'rezervovano', 'prodano', 'pronajato'];
const STATUS_CARD_LABEL = {
    nova:         'NOVÁ NABÍDKA',
    aktivni:      null,            // active = use available_from or "AKTUÁLNÍ"
    rezervovano:  'REZERVOVÁNO',
    pronajato:    'PRONAJATO',
    prodano:      'PRODÁNO',
};
const STATUS_I18N = {
    nova:         'listings.status.new',
    aktivni:      null,
    rezervovano:  'listings.status.reserved',
    pronajato:    'listings.status.rented',
    prodano:      'listings.status.sold',
};
const STATUS_CLASS = {
    nova:         'status-active',
    aktivni:      'status-active',
    rezervovano:  'status-reserved',
    pronajato:    'status-closed',
    prodano:      'status-closed',
};

// Icon mapping for spec cards
const SPEC_ICONS = {
    'Rok rekonstrukce':     '⌂',
    'Energetická třída':    '⚡',
    'Výtah':                '⇕',
    'Sklep':                '▦',
    'Balkon':               '◐',
    'Balkon / lodžie':      '◐',
    'Lodžie':               '◐',
    'Parkování':            '⌭',
    'Parking':              '⌭',
    'Garáž':                '⌭',
    'Orientace':            '☀',
    'Vybavení':             '✓',
    'Typ stavby':           '⌂',
    'Vlastnictví':          '◊',
    'Stav':                 '✦',
    'Podlahové vytápění':   '♨',
    'Kuchyňská linka':      '⌂',
    'Koupelna':             '◐',
    'Okna':                 '⊞',
    'Podlahy':              '▦',
    'Omítky':               '✦',
    'Rozvody':              '⚡',
};

// Recognized body section headings (aliases → canonical)
const SECTION_ALIASES = {
    'O této nemovitosti':   'description',
    'O nemovitosti':        'description',
    'Popis':                'description',
    'Vybavení a stav':      'specs',
    'Specifikace':          'specs',
    'Podmínky pronájmu':    'rental_terms',  // currently unused (data lives in sidebar)
    'Hlavní výhody projektu': 'highlights',
    'Investiční záměr':       'investment_intent',
    'Stav nemovitosti':       'state_description',
    'Investiční potenciál':   'investment_case_md',  // markdown body fallback if frontmatter map absent
};

// ===== HELPERS =====
function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Minimal YAML frontmatter parser. */
function parseFrontmatter(src) {
    const m = src.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
    if (!m) throw new Error('Missing YAML frontmatter');
    const data = {};
    let currentMap = null;
    for (const line of m[1].split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        if (/^\s{2,}/.test(line) && currentMap) {
            const nm = line.trim().match(/^([^:]+):\s*(.*)$/);
            if (nm) {
                let v = nm[2].trim();
                if ((v.startsWith('"') && v.endsWith('"')) ||
                    (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
                currentMap[nm[1].trim()] = v;
            }
            continue;
        }
        const tm = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/);
        if (!tm) continue;
        const key = tm[1];
        let val = tm[2].trim();
        if (val === '') { data[key] = {}; currentMap = data[key]; continue; }
        currentMap = null;
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        data[key] = val;
    }
    return { data, body: m[2] };
}

/** Split Markdown body by H2 headings; map heading → canonical key via SECTION_ALIASES. */
function parseSections(body) {
    const out = {};
    if (!body) return out;
    const parts = body.split(/^##\s+/m);
    for (let i = 1; i < parts.length; i++) {
        const [heading, ...rest] = parts[i].split('\n');
        const canonical = SECTION_ALIASES[heading.trim()];
        if (canonical) out[canonical] = rest.join('\n').trim();
    }
    return out;
}

/** Minimal markdown inline: **bold** + *italic* + escape. Safe for body prose. */
function renderInline(s) {
    let out = escapeHtml(s);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    return out;
}

function renderDescription(text) {
    if (!text) return '';
    return text.split(/\n\s*\n/)
        .map(p => p.trim()).filter(Boolean)
        .map(p => '                <p>' + renderInline(p) + '</p>')
        .join('\n');
}

function parseSpecs(text) {
    if (!text) return [];
    return text.split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('-'))
        .map(l => {
            const m = l.match(/^-\s*\**\s*([^:*]+?)\s*\**\s*:\s*(.*)$/);
            return m ? { label: m[1].trim(), value: m[2].trim() } : null;
        })
        .filter(Boolean);
}

function renderSpecCards(specs) {
    if (!specs.length) return '            <!-- No spec entries -->';
    return specs.map(s => {
        const icon = SPEC_ICONS[s.label] || '⌂';
        return `            <div class="listing-spec-card">
                <div class="listing-spec-icon">${icon}</div>
                <div class="listing-spec-label">${escapeHtml(s.label)}</div>
                <div class="listing-spec-value">${escapeHtml(s.value)}</div>
            </div>`;
    }).join('\n');
}

// Canonical info-panel labels → i18n keys (CZ default text is the literal map key).
// Custom info_extra keys from info.md fall through as raw labels (no i18n).
const INFO_LABEL_I18N = {
    'Dispozice':   'listings.info.disposition',
    'Plocha':      'listings.info.area',
    'Patro':       'listings.info.floor',
    'Typ stavby':  'listings.info.buildingType',
    'Vlastnictví': 'listings.info.ownership',
    'Stav':        'listings.info.condition',
    'Lokalita':    'listings.info.location',
};

/**
 * Investicni info panel — investment-oriented sidebar with property metrics.
 * Layout: large price → property metrics → state badge → CTA.
 */
function renderInvestorInfoPanel(l) {
    const rows = [];
    if (l.price_per_sqm)        rows.push(['Cena za m²',           l.price_per_sqm, 'listings.info.pricePerSqm']);
    if (l.size_total)           rows.push(['Celková plocha',       l.size_total,    'listings.info.areaTotal']);
    if (l.units != null && l.units !== '') rows.push(['Bytové jednotky', String(l.units), 'listing.detail.units']);
    if (l.occupancy)            rows.push(['Obsazenost',            l.occupancy,     'listings.info.occupancy']);
    if (l.declaration_of_owner) rows.push(['Prohlášení vlastníka',  l.declaration_of_owner, 'listing.detail.declaration']);
    if (l.location_long)        rows.push(['Lokalita',              l.location_long, 'listings.info.location']);

    const rowsHtml = rows.map(([label, value, key]) =>
        `                    <div class="listing-info-row">
                        <span class="listing-info-label" data-i18n="${key}">${escapeHtml(label)}</span>
                        <span class="listing-info-value">${escapeHtml(value)}</span>
                    </div>`
    ).join('\n');

    const stateBadge = l.state
        ? `                <div class="listing-info-state-row">
                    <span class="listing-info-label" data-i18n="listing.detail.state.label">Stav nemovitosti</span>
                    <span class="listing-info-state-badge" data-i18n="listing.detail.state.renovation">${escapeHtml(l.state)}</span>
                </div>`
        : '';

    return `                <div class="listing-info-pricelabel" data-i18n="listings.info.priceLabel.invest">Cena</div>
                <div class="listing-info-price">${escapeHtml(l.price || 'Cena na vyžádání')}</div>
${stateBadge}
                <div class="listing-info-table">
${rowsHtml}
                </div>`;
}

/** Highlights bullet-list section (parsed from `## Hlavní výhody projektu` body). */
function renderHighlights(text) {
    if (!text) return '';
    const items = text.split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('-'))
        .map(l => '                    <li>' + escapeHtml(l.replace(/^-\s*/, '')) + '</li>')
        .join('\n');
    if (!items) return '';
    return `        <section class="listing-highlights-section">
            <div class="container">
                <h2 class="section-title" data-i18n="listing.detail.highlights.title">Hlavní výhody projektu</h2>
                <ul class="listing-highlights">
${items}
                </ul>
            </div>
        </section>`;
}

/** Investment-case dark box (uses frontmatter investment_case map). */
function renderInvestmentCase(ic) {
    if (!ic || typeof ic !== 'object') return '';
    const rows = [];
    if (ic.buy_price_per_sqm)    rows.push(['Cena za m² (nákup)',                ic.buy_price_per_sqm,    false]);
    if (ic.market_price_per_sqm) rows.push(['Tržní cena za m² po rekonstrukci',  ic.market_price_per_sqm, false]);
    if (ic.estimated_resale)     rows.push(['Předpokládaná prodejní cena',       ic.estimated_resale,     false]);
    if (ic.gross_margin)         rows.push(['Hrubá marže',                       ic.gross_margin,         true]);
    if (!rows.length) return '';
    const rowsHtml = rows.map(([label, value, highlight]) =>
        `                    <div class="investment-case-row${highlight ? ' is-highlight' : ''}">
                        <span class="investment-case-label">${escapeHtml(label)}</span>
                        <span class="investment-case-value">${escapeHtml(value)}</span>
                    </div>`
    ).join('\n');
    return `        <section class="listing-investment-case-section">
            <div class="container">
                <h2 class="section-title" data-i18n="listing.detail.investment_case.title">Investiční potenciál</h2>
                <div class="investment-case">
${rowsHtml}
                </div>
                <p class="investment-case-disclaimer" data-i18n="listing.detail.investment_case.disclaimer">Čísla jsou orientační, vycházejí z aktuálních lokálních benchmarků. Přesná kalkulace dle individuálního projektu rekonstrukce a strategie prodeje.</p>
            </div>
        </section>`;
}

/** Investment-intent section: paragraphs + optional blockquote (markdown `> ` lines). */
function renderInvestmentIntent(text) {
    if (!text) return '';
    const blocks = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const html = blocks.map(b => {
        if (b.startsWith('>')) {
            // Strip leading '>' on each line, leading/trailing surrounding *…* (markdown italic),
            // and tidy the Czech curly quotes that wrap the quote body.
            let quote = b.split('\n')
                .map(l => l.replace(/^>\s*/, ''))
                .join(' ')
                .trim()
                .replace(/^[*_]+|[*_]+$/g, '')
                .trim();
            // The quoted text itself stays — including its inner Czech „…" pair
            return '                <blockquote class="listing-quote">' + renderInline(quote) + '</blockquote>';
        }
        return '                <p>' + renderInline(b) + '</p>';
    }).join('\n');
    return `        <section class="listing-intent-section">
            <div class="container">
                <h2 class="section-title" data-i18n="listing.detail.intent.title">Investiční záměr</h2>
                <div class="listing-intent-body">
${html}
                </div>
            </div>
        </section>`;
}

/** Generic "Stav nemovitosti" prose section. */
function renderStateDescription(text) {
    if (!text) return '';
    const html = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
        .map(p => '                <p>' + renderInline(p) + '</p>').join('\n');
    return `        <section class="listing-state-section">
            <div class="container">
                <h2 class="section-title" data-i18n="listing.detail.state.title">Stav nemovitosti</h2>
                <div class="listing-state-body">
${html}
                </div>
            </div>
        </section>`;
}

/** Render info panel sidebar — variant based on type (rental shows kauce/provize/availability). */
function renderInfoPanel(l) {
    const isRental = l.type === 'pronajem';
    const priceLabel    = isRental ? 'Měsíční nájemné' : 'Cena';
    const priceLabelKey = isRental ? 'listings.info.priceLabel.rent' : 'listings.info.priceLabel.sale';
    const rows = [];

    if (l.disposition)    rows.push(['Dispozice',  l.disposition]);
    if (l.area)           rows.push(['Plocha',     l.area + ' m²']);
    if (l.floor)          rows.push(['Patro',      l.floor]);
    if (l.building_type)  rows.push(['Typ stavby', l.building_type]);
    if (l.ownership)      rows.push(['Vlastnictví', l.ownership]);
    if (l.condition)      rows.push(['Stav',       l.condition]);
    if (l.location_long || l.location_short)
        rows.push(['Lokalita', l.location_long || l.location_short]);
    if (l.info_extra && typeof l.info_extra === 'object') {
        for (const k of Object.keys(l.info_extra)) {
            rows.push([k, l.info_extra[k]]);
        }
    }

    const labelAttr = (label) => INFO_LABEL_I18N[label] ? ` data-i18n="${INFO_LABEL_I18N[label]}"` : '';

    let rentalExtras = '';
    if (isRental && (l.deposit || l.commission || l.available_from)) {
        const items = [];
        if (l.deposit)        items.push(`<div><span data-i18n="listings.info.deposit">Kauce</span><strong>${escapeHtml(l.deposit)}</strong></div>`);
        if (l.commission)     items.push(`<div><span data-i18n="listings.info.commission">Provize</span><strong>${escapeHtml(l.commission)}</strong></div>`);
        if (l.available_from) items.push(`<div><span data-i18n="listings.info.availableFrom">Dostupnost</span><strong>${escapeHtml(l.available_from)}</strong></div>`);
        rentalExtras = `                <div class="listing-info-rental-extras">\n                    ${items.join('\n                    ')}\n                </div>`;
    }

    const rowsHtml = rows.map(([label, value]) =>
        `                    <div class="listing-info-row">
                        <span class="listing-info-label"${labelAttr(label)}>${escapeHtml(label)}</span>
                        <span class="listing-info-value">${escapeHtml(value)}</span>
                    </div>`
    ).join('\n');

    const priceText = l.price || 'Cena na vyžádání';
    const priceAttr = l.price ? '' : ' data-i18n="listings.info.priceOnRequest"';

    return `                <div class="listing-info-pricelabel" data-i18n="${priceLabelKey}">${priceLabel}</div>
                <div class="listing-info-price"${priceAttr}>${escapeHtml(priceText)}</div>
${rentalExtras}
                <div class="listing-info-table">
${rowsHtml}
                </div>`;
}

function listImages(slug, type) {
    const dir = path.join(LISTINGS_DIR, type, slug);
    return fs.readdirSync(dir)
        .filter(f => IMG_EXT.test(f))
        .sort();
}

function findCover(images) {
    const exact = images.find(f => COVER_NAME.test(f));
    return exact || images[0] || null;
}

/**
 * Czech-default plural for the "Zobrazit … X fotek" button.
 * The runtime JS re-renders this string per language via Intl.PluralRules,
 * keyed off data-i18n-key="listings.photos" + data-i18n-count="{n}".
 */
function pluralizePhotos(n) {
    if (n === 1)              return 'Zobrazit fotku';
    if (n >= 2 && n <= 4)     return `Zobrazit všechny ${n} fotky`;
    return `Zobrazit všech ${n} fotek`;
}

/**
 * Airbnb-style gallery: hero tile (left, 2 rows tall) + 2×2 thumbnails (right).
 * Shows up to 5 tiles; the 5th carries a "+N dalších" overlay when more remain.
 * Full image list is embedded as JSON in data-gallery for the lightbox JS.
 * `imgPathPrefix` is the relative prefix from the detail page back to /images/.
 * `isVisualization` toggles the "Vizualizace po rekonstrukci" watermark on the cover tile.
 */
function renderGallery(slug, type, images, title, imgPathPrefix, isVisualization, heroRibbon) {
    if (!images.length) return '            <!-- No gallery photos -->';
    imgPathPrefix = imgPathPrefix || '../../../';
    const titleEsc = escapeHtml(title);
    const visible = images.slice(0, 5);
    const remaining = Math.max(0, images.length - visible.length);

    // Lightbox payload — every image with a readable alt and a watermark flag.
    const galleryData = images.map((file, i) => ({
        src: `${imgPathPrefix}images/listings/${type}/${slug}/${file}`,
        alt: i === 0 ? title : `${title} — foto ${i + 1}`,
        watermark: i === 0 && isVisualization,
    }));
    const dataAttr = escapeHtml(JSON.stringify(galleryData));

    const watermarkBadge = '<span class="listing-watermark" aria-hidden="true" data-i18n="listing.detail.visualization_badge">Vizualizace po rekonstrukci</span>';

    const tiles = visible.map((file, i) => {
        const src  = `${imgPathPrefix}images/listings/${type}/${slug}/${file}`;
        const alt  = i === 0 ? titleEsc : `${titleEsc} — foto ${i + 1}`;
        const hero = i === 0 ? ' is-hero' : '';
        const showOverlay = (i === visible.length - 1) && remaining > 0;
        const loading = i === 0 ? 'eager' : 'lazy';
        const wm = i === 0 && isVisualization ? `\n                ${watermarkBadge}` : '';
        const rb = i === 0 && heroRibbon ? `\n                ${heroRibbon}` : '';
        return `            <button type="button" class="listing-gallery-item${hero}" data-gallery-open data-index="${i}" aria-label="Otevřít fotku ${i + 1} z ${images.length}">
                <img src="${src}" alt="${alt}" loading="${loading}">${wm}${rb}${showOverlay ? `
                <span class="listing-gallery-more" aria-hidden="true" data-i18n-key="listings.photos.more" data-i18n-count="${remaining}">+${remaining} dalších</span>` : ''}
            </button>`;
    }).join('\n');

    return `        <div class="listing-gallery-wrap">
            <div class="listing-gallery" data-gallery="${dataAttr}">
${tiles}
            </div>
            <button type="button" class="listing-gallery-showall" data-gallery-open data-index="0" aria-label="${escapeHtml(pluralizePhotos(images.length))}">
                <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M3 3h6v6H3V3zm8 0h6v6h-6V3zM3 11h6v6H3v-6zm8 0h6v6h-6v-6z"/></svg>
                <span data-i18n-key="listings.photos" data-i18n-count="${images.length}">${escapeHtml(pluralizePhotos(images.length))}</span>
            </button>
        </div>`;
}

function renderCardBadge(l) {
    const typeLbl  = TYPE_LABEL[l.type] || '';
    const typeKey  = TYPE_I18N[l.type] || '';
    const status   = l.status || 'aktivni';
    const klass    = STATUS_CLASS[status] || 'status-active';
    const typeSpan = typeLbl ? `<span data-i18n="${typeKey}">${escapeHtml(typeLbl)}</span>` : '';

    // Build a "[type] · [extra]" pair. The status word is i18n-aware via
    // STATUS_I18N; available_from text comes from info.md and stays raw.
    let extraSpan = '';
    if (status === 'aktivni') {
        if (l.type === 'pronajem' && l.available_from) {
            extraSpan = `<span>${escapeHtml(String(l.available_from).toUpperCase())}</span>`;
        }
    } else if (status === 'pronajato' || status === 'prodano') {
        // Closed states: status word replaces the type word
        const statusLbl = STATUS_CARD_LABEL[status];
        const statusKey = STATUS_I18N[status];
        return `                    <div class="listing-card-badge ${klass}"><span data-i18n="${statusKey}">${escapeHtml(statusLbl)}</span></div>`;
    } else if (status === 'rezervovano' || status === 'nova') {
        const statusLbl = STATUS_CARD_LABEL[status];
        const statusKey = STATUS_I18N[status];
        extraSpan = `<span data-i18n="${statusKey}">${escapeHtml(statusLbl)}</span>`;
    }

    const sep = extraSpan ? '<span class="badge-sep"> · </span>' : '';
    return `                    <div class="listing-card-badge ${klass}">${typeSpan}${sep}${extraSpan}</div>`;
}

function renderCardMeta(l) {
    const parts = [];
    if (l.disposition)   parts.push(l.disposition);
    if (l.area)          parts.push(l.area + ' m²');
    if (l.floor)         parts.push(l.floor);
    else if (l.building_type) parts.push(l.building_type);

    return parts.map((p, i) => {
        return (i === 0 ? '' : '                        <span class="sep">·</span>\n')
             + `                        <span>${escapeHtml(p)}</span>`;
    }).join('\n');
}

/**
 * Czech-default plural for "X aktivních nabídek".
 * Runtime JS re-renders this per language via Intl.PluralRules, keyed off
 * data-i18n-key="listings.count" + data-i18n-count="{n}".
 */
function pluralizeOffers(n) {
    if (n === 1)              return `${n} aktivní nabídka`;
    if (n >= 2 && n <= 4)     return `${n} aktivní nabídky`;
    return `${n} aktivních nabídek`;
}

/** Czech-default plural for "X aktivních příležitostí" (investor landing counter). */
function pluralizeInvestorOffers(n) {
    if (n === 1)              return `${n} aktivní příležitost`;
    if (n >= 2 && n <= 4)     return `${n} aktivní příležitosti`;
    return `${n} aktivních příležitostí`;
}

/**
 * Shorten a price string for the mobile sticky CTA bar.
 * "15 900 000 Kč" → "15,9 mil Kč";  "13 900 Kč / měsíc" → "13,9 tis. Kč / měsíc"
 * Falls back to the original string if no numeric token can be parsed.
 */
function shortenPriceForSticky(s) {
    if (!s) return '';
    const digits = (s.match(/\d+/g) || []).join('');
    if (!digits) return s;
    const n = parseInt(digits, 10);
    if (!Number.isFinite(n)) return s;
    // Currency: take the last alpha token (Kč, EUR, …). Default to Kč.
    const curMatch = s.match(/(Kč|CZK|EUR|€|USD|\$)/i);
    const currency = curMatch ? curMatch[0] : 'Kč';
    // Trailing qualifier like "/ měsíc"
    const suffixMatch = s.match(/\/\s*\S+\s*$/);
    const suffix = suffixMatch ? ' ' + suffixMatch[0].trim() : '';
    const fmt = (val, unit) => {
        let str = val.toFixed(1);
        if (str.endsWith('.0')) str = str.slice(0, -2);
        return `${str.replace('.', ',')} ${unit} ${currency}${suffix}`;
    };
    if (n >= 1_000_000) return fmt(n / 1_000_000, 'mil');
    if (n >= 1_000)     return fmt(n / 1_000,     'tis.');
    return s;
}

/** Big category-choice cards shown only on /nabidka/ root, above the secondary filter tabs. */
function renderCategoryCards(counts) {
    return `        <div class="category-choice">
            <a href="/nabidka/pronajem/" class="category-card">
                <div class="category-card-icon" aria-hidden="true">
                    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="17" cy="24" r="8"/>
                        <path d="M25 24h17M38 24v6M32 24v4"/>
                    </svg>
                </div>
                <div class="category-card-body">
                    <div class="category-card-eyebrow" data-i18n="listings.cat.rent.eyebrow">Nabídka pronájmů</div>
                    <h2 class="category-card-title" data-i18n="listings.cat.rent.title">Pronájem</h2>
                    <p class="category-card-subtitle" data-i18n="listings.cat.rent.desc">Byty a domy k pronajmutí přímo od majitele — bez provize, ihned k nastěhování.</p>
                </div>
                <div class="category-card-meta">
                    <span data-i18n-key="listings.count" data-i18n-count="${counts.pronajem}">${pluralizeOffers(counts.pronajem)}</span>
                    <span class="category-card-arrow">→</span>
                </div>
            </a>
            <a href="/nabidka/prodej/" class="category-card">
                <div class="category-card-icon" aria-hidden="true">
                    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M8 23L24 9l16 14"/>
                        <path d="M12 21v18h24V21"/>
                        <path d="M20 39V28h8v11"/>
                    </svg>
                </div>
                <div class="category-card-body">
                    <div class="category-card-eyebrow" data-i18n="listings.cat.sale.eyebrow">Nabídka k prodeji</div>
                    <h2 class="category-card-title" data-i18n="listings.cat.sale.title">Prodej</h2>
                    <p class="category-card-subtitle" data-i18n="listings.cat.sale.desc">Pečlivě vybrané byty a domy k investici i k bydlení po důkladné due diligence.</p>
                </div>
                <div class="category-card-meta">
                    <span data-i18n-key="listings.count" data-i18n-count="${counts.prodej}">${pluralizeOffers(counts.prodej)}</span>
                    <span class="category-card-arrow">→</span>
                </div>
            </a>
        </div>`;
}

/** Secondary filter nav under the hero. `activeTab` is one of 'vse' | 'pronajem' | 'prodej'. */
function renderFilterNav(activeTab, showLabel) {
    const tab = (key, href, label, i18nKey) =>
        `<a href="${href}"${key === activeTab ? ' class="active" aria-current="page"' : ''} data-i18n="${i18nKey}">${label}</a>`;
    const label = showLabel
        ? '        <div class="listings-tabs-label" data-i18n="listings.tabs.label">Nebo si projděte všechny nabídky</div>\n'
        : '';
    return `${label}        <nav class="listings-tabs" aria-label="Filtr nabídek">
            ${tab('vse',      '/nabidka/',          'Vše',      'listings.tabs.all')}
            ${tab('pronajem', '/nabidka/pronajem/', 'Pronájem', 'listings.tabs.rent')}
            ${tab('prodej',   '/nabidka/prodej/',   'Prodej',   'listings.tabs.sale')}
        </nav>`;
}

function renderTemplate(template, replacements) {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        if (replacements[key] !== undefined) return replacements[key];
        console.warn(`  ⚠ Unmapped placeholder {{${key}}}`);
        return match;
    });
}

function readTemplate(name) {
    return fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8');
}

function readListing(type, slug) {
    const infoPath = path.join(LISTINGS_DIR, type, slug, 'info.md');
    if (!fs.existsSync(infoPath)) {
        throw new Error(`Missing info.md in images/listings/${type}/${slug}/`);
    }
    const { data, body } = parseFrontmatter(fs.readFileSync(infoPath, 'utf8'));
    const sections = parseSections(body);
    const images = listImages(slug, type);
    const cover = findCover(images);

    if (data.type && data.type !== type) {
        console.warn(`  ⚠ ${slug}: frontmatter type="${data.type}" disagrees with folder type="${type}"`);
    }
    if (!cover) {
        console.warn(`  ⚠ ${slug}: no cover image found (looked for 01-uvodni.*, then any image)`);
    } else if (!COVER_NAME.test(cover)) {
        console.warn(`  ⚠ ${slug}: 01-uvodni.* not found — using "${cover}" as cover instead`);
    }

    return {
        slug,
        type,
        title: data.title || slug,
        status: data.status || 'aktivni',
        price: data.price || 'Cena na vyžádání',
        deposit: data.deposit || '',
        commission: data.commission || '',
        available_from: data.available_from || '',
        location: data.location || '',
        location_short: data.location_short || data.location || '',
        location_long: data.location_long || data.location_short || data.location || '',
        disposition: data.disposition || '',
        area: data.area != null ? data.area : '',
        floor: data.floor || '',
        building_type: data.building_type || '',
        ownership: data.ownership || '',
        condition: data.condition || '',
        short_description: data.short_description || '',
        info_extra: data.info_extra || null,
        // Investicni-specific frontmatter fields
        price_per_sqm: data.price_per_sqm || '',
        size_total: data.size_total || '',
        units: data.units || '',
        state: data.state || '',
        occupancy: data.occupancy || '',
        declaration_of_owner: data.declaration_of_owner || '',
        cta: data.cta || '',
        cover_is_visualization: String(data.cover_is_visualization).toLowerCase() === 'true',
        investment_case: data.investment_case || null,
        description:        sections.description || '',
        highlights:         sections.highlights || '',
        investment_intent:  sections.investment_intent || '',
        state_description:  sections.state_description || '',
        specs: parseSpecs(sections.specs || ''),
        cover,
        gallery: images,
    };
}

// ===== BUILD =====
function build() {
    if (!fs.existsSync(LISTINGS_DIR)) {
        console.error(`✗ Listings folder missing: ${LISTINGS_DIR}`);
        process.exit(1);
    }

    // Walk type subdirectories
    const listings = [];
    for (const type of TYPES) {
        const typeDir = path.join(LISTINGS_DIR, type);
        if (!fs.existsSync(typeDir)) continue;
        const slugs = fs.readdirSync(typeDir)
            .filter(f => !f.startsWith('_') && !f.startsWith('.'))
            .filter(f => fs.statSync(path.join(typeDir, f)).isDirectory());
        for (const slug of slugs) listings.push(readListing(type, slug));
    }

    listings.sort((a, b) => {
        const ai = STATUS_ORDER.indexOf(a.status);
        const bi = STATUS_ORDER.indexOf(b.status);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    console.log(`Found ${listings.length} listing(s): ${listings.map(l => `${l.type}/${l.slug}`).join(', ')}`);

    const cardTpl = readTemplate('listing-card.html');
    // Detail templates lazily loaded by type
    const detailTplCache = {};
    const detailTplFor = (type) => {
        const tplFile = DETAIL_OUTPUT[type].template;
        if (!detailTplCache[tplFile]) detailTplCache[tplFile] = readTemplate(tplFile);
        return detailTplCache[tplFile];
    };
    // Index templates lazily loaded by name
    const indexTplCache = {};
    const indexTplFor = (name) => {
        if (!indexTplCache[name]) indexTplCache[name] = readTemplate(name);
        return indexTplCache[name];
    };

    // Detail pages — output path + template depend on listing type
    for (const l of listings) {
        const cfg = DETAIL_OUTPUT[l.type];
        if (!cfg) { console.warn(`  ⚠ ${l.type}/${l.slug}: no DETAIL_OUTPUT config`); continue; }
        const dir = path.join(ROOT, cfg.outputBase, l.slug);
        fs.mkdirSync(dir, { recursive: true });

        const coverSrc = `${cfg.base}images/listings/${l.type}/${l.slug}/${l.cover}`;
        const isInvest = l.type === 'investicni';
        const reservedRibbon = l.status === 'rezervovano'
            ? '<span class="listing-ribbon" data-i18n="listings.status.reserved">REZERVOVÁNO</span>'
            : '';

        const html = renderTemplate(detailTplFor(l.type), {
            base: cfg.base,
            slug: l.slug,
            type: l.type,
            type_label: TYPE_LABEL[l.type] || '',
            title: escapeHtml(l.title),
            price: escapeHtml(l.price),
            location_short: escapeHtml(l.location_short),
            location_long: escapeHtml(l.location_long),
            disposition: escapeHtml(l.disposition),
            area: escapeHtml(l.area + ' m²'),
            floor: escapeHtml(l.floor || ''),
            short_description: escapeHtml(l.short_description),
            cover_src: coverSrc,
            cover_filename: l.cover || '',
            status_ribbon: isInvest ? '' : reservedRibbon,
            og_image_type: /\.png$/i.test(l.cover || '') ? 'image/png' : (/\.webp$/i.test(l.cover || '') ? 'image/webp' : 'image/jpeg'),
            cover_watermark_class: l.cover_is_visualization ? ' has-watermark' : '',
            cover_watermark_overlay: l.cover_is_visualization
                ? '    <span class="listing-watermark listing-watermark-hero" aria-hidden="true" data-i18n="listing.detail.visualization_badge">Vizualizace po rekonstrukci</span>'
                : '',
            description_html: renderDescription(l.description),
            info_panel: isInvest ? renderInvestorInfoPanel(l) : renderInfoPanel(l),
            spec_cards: renderSpecCards(l.specs),
            gallery_items: renderGallery(l.slug, l.type, l.gallery, l.title, cfg.base, l.cover_is_visualization, isInvest ? reservedRibbon : ''),
            // Investicni-only sections
            highlights_section:        isInvest ? renderHighlights(l.highlights) : '',
            investment_case_section:   isInvest ? renderInvestmentCase(l.investment_case) : '',
            investment_intent_section: isInvest ? renderInvestmentIntent(l.investment_intent) : '',
            state_section:             isInvest ? renderStateDescription(l.state_description) : '',
            // Sticky CTA for mobile (investicni only)
            sticky_cta: isInvest
                ? `        <div class="listing-detail-cta-sticky">
            <div class="listing-detail-cta-sticky-price">${escapeHtml(shortenPriceForSticky(l.price))}</div>
            <a href="${cfg.base}contact.html" class="btn btn-primary" data-i18n="listing.detail.cta.viewing">${escapeHtml(l.cta || 'Domluvit prohlídku')}</a>
        </div>`
                : '',
            // Pre-built convenience strings for hero meta line (nabidka templates only)
            hero_meta_disposition: l.disposition ? `<span>✦ ${escapeHtml(l.disposition)} dispozice</span>` : '',
            hero_meta_area:        l.area ? `<span>◊ ${escapeHtml(l.area)} m² užitné plochy</span>` : '',
            hero_meta_floor:       l.floor ? `<span>⛶ ${escapeHtml(l.floor)}</span>` : (l.building_type ? `<span>⛶ ${escapeHtml(l.building_type)}</span>` : ''),
            // Back link → type-level landing page
            type_index_path: isInvest ? '/investors/' : `/nabidka/${l.type}/`,
        });

        fs.writeFileSync(path.join(dir, 'index.html'), html);
        console.log(`  → ${cfg.outputBase}/${l.slug}/index.html  (${l.gallery.length} photo${l.gallery.length === 1 ? '' : 's'})`);
    }

    // Counts per type — fed into the big category-choice cards on the root nabidka page.
    const counts = {
        pronajem:   listings.filter(l => l.type === 'pronajem').length,
        prodej:     listings.filter(l => l.type === 'prodej').length,
        investicni: listings.filter(l => l.type === 'investicni').length,
    };

    // Index pages (unified + per-type)
    const NABIDKA_TYPES = new Set(['pronajem', 'prodej']);
    for (const page of INDEX_PAGES) {
        // For nabidka root (filter:null) → only pronajem + prodej, not investicni
        const filtered = page.filter
            ? listings.filter(l => l.type === page.filter)
            : listings.filter(l => NABIDKA_TYPES.has(l.type));
        const isNabidkaRoot = page.outputBase === 'nabidka' && page.filter === null;
        const isInvestorLanding = page.template === 'investors-landing.html';
        const base = '../'.repeat(page.depth);

        // Card href is always absolute → works with cleanUrls regardless of trailing slash
        const cardsHtml = filtered.map(l => {
            // investicni cards link into /investors/{slug}/, others into /nabidka/{type}/{slug}/
            const href = l.type === 'investicni'
                ? `/investors/${l.slug}/`
                : `/nabidka/${l.type}/${l.slug}/`;
            const coverSrc = `${base}images/listings/${l.type}/${l.slug}/${l.cover}`;
            return renderTemplate(cardTpl, {
                href,
                title: escapeHtml(l.title),
                price: escapeHtml(l.price),
                location_short: escapeHtml(l.location_short),
                short_description: escapeHtml(l.short_description),
                cover_src: coverSrc,
                cover_alt: escapeHtml(l.title),
                cover_watermark: l.cover_is_visualization
                    ? '                    <span class="listing-watermark listing-watermark-card" aria-hidden="true" data-i18n="listing.detail.visualization_badge">Vizualizace po rekonstrukci</span>'
                    : '',
                badge: renderCardBadge(l),
                meta_line: renderCardMeta(l),
            });
        }).join('\n');

        const outDir = path.join(ROOT, page.outputBase);
        fs.mkdirSync(outDir, { recursive: true });

        // Placeholder for empty investor landing (uses .coming-soon block)
        const investorEmpty = isInvestorLanding && !filtered.length
            ? `        <section class="coming-soon">
            <div class="coming-soon-inner">
                <span class="coming-soon-icon" aria-hidden="true">⌂</span>
                <h2 data-i18n="investors.placeholder.title">Brzy zde najdete aktuální nabídky</h2>
                <p data-i18n="investors.placeholder.text">Pracuji na první sérii investičních příležitostí. Pokud máte zájem o spolupráci nebo chcete být první, kdo se dozví o nových projektech, ozvěte se.</p>
                <a href="${base}contact.html" class="btn btn-primary" data-i18n="investors.placeholder.cta" style="padding: 14px 28px; font-size: 14.5px; font-weight: 600;">Domluvit schůzku</a>
            </div>
        </section>`
            : '';

        const replacements = {
            base,
            cards: cardsHtml || '            <!-- žádné nabídky v této kategorii -->',
            eyebrow: page.eyebrow,
            eyebrow_key: page.eyebrow_key,
            h1: page.h1,
            h1_key: page.h1_key,
            category_cards: isNabidkaRoot ? renderCategoryCards(counts) : '',
            filter_nav: !isInvestorLanding ? renderFilterNav(page.tab, isNabidkaRoot) : '',
            counter: filtered.length
                ? `<span class="listings-counter" data-i18n-key="listing.investicni.counter" data-i18n-count="${filtered.length}">${pluralizeInvestorOffers(filtered.length)}</span>`
                : '',
            grid_or_placeholder: investorEmpty,
            empty_notice: !isInvestorLanding && !filtered.length
                ? '<p class="listings-empty" data-i18n-html="listings.empty.text" style="text-align:center;color:var(--text-muted);padding:60px 0;">Aktuálně zde nemáme žádnou nabídku. Mrkněte na další kategorie nebo nás <a href="' + base + 'contact.html" style="color:var(--accent-dark);font-weight:600;">kontaktujte</a>.</p>'
                : '',
        };

        const html = renderTemplate(indexTplFor(page.template), replacements);
        fs.writeFileSync(path.join(outDir, 'index.html'), html);
        console.log(`  → ${page.outputBase}/index.html  (${filtered.length} card${filtered.length === 1 ? '' : 's'})`);
    }

    // Sitemap
    const today = new Date().toISOString().split('T')[0];
    const urls = [
        ...STATIC_ROUTES,
        // Sub-landing pages (per-type indexes). 'nabidka' and 'investors' are
        // already in STATIC_ROUTES; only emit the deeper 'nabidka/pronajem' and
        // 'nabidka/prodej' filtered indexes.
        ...INDEX_PAGES
            .filter(p => p.outputBase !== 'nabidka' && p.outputBase !== 'investors')
            .map(p => ({ loc: '/' + p.outputBase, priority: '0.8', changefreq: 'weekly' })),
        ...listings.map(l => ({
            loc: l.type === 'investicni'
                ? `/investors/${l.slug}`
                : `/nabidka/${l.type}/${l.slug}`,
            priority: '0.7',
            changefreq: 'monthly',
        })),
    ];
    const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">\n' +
        urls.map(u =>
            `  <url>
    <loc>${SITE_URL}${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
        ).join('\n') +
        '\n</urlset>\n';
    fs.writeFileSync(SITEMAP_PATH, sitemap);
    console.log(`  → sitemap.xml (${urls.length} URLs)`);

    console.log('✓ Build complete');
}

build();
