#!/usr/bin/env node
/**
 * build.js — file-based listings generator (categories: pronajem / prodej / investicni)
 *
 * Folder structure: images/listings/{type}/{slug}/
 *   - info.md       YAML frontmatter + Markdown body
 *   - 01-uvodni.jpg cover photo (preferred name)
 *   - 01.jpg ...    additional gallery photos
 *   - _nahled/      smaller JPEG copies of every photo (<name>-800.jpg, <name>-320.jpg).
 *                   Created automatically when the build runs on a Mac (sips);
 *                   commit them together with the photos.
 *
 * Cover lookup order:
 *   1) 01-uvodni.jpg (or .jpeg / .png / .webp)
 *   2) first alphabetically sorted image — with warning
 *
 * Gallery = ALL image files in the folder (including the cover).
 *
 * Generates:
 *   - nabidka/index.html, nabidka/{pronajem,prodej}/index.html   listing indexes
 *   - nabidka/{pronajem,prodej}/{slug}/index.html                detail pages
 *   - investors/index.html, investors/{slug}/index.html          investor landing + details
 *   - index.html — ONLY the block between <!-- NABIDKY:START --> and <!-- NABIDKY:END -->
 *   - sitemap.xml
 *   - dist/        the deployable site: public files only, local asset URLs get ?v=<hash>
 *
 * The build stops (exit 1) when an info.md has an empty field, an unknown
 * "## heading", or no title/price — so a broken listing never reaches the web.
 *
 * Zero npm dependencies. Run: `node build.js`
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { execFileSync } = require('child_process');

// ===== CONFIG =====
const ROOT = __dirname;
const LISTINGS_DIR = path.join(ROOT, 'images', 'listings');
const TEMPLATES_DIR = path.join(ROOT, '_templates');
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');
const HOMEPAGE_PATH = path.join(ROOT, 'index.html');
const DIST_DIR = path.join(ROOT, 'dist');
const GENERATED_DIRS = ['nabidka', 'investors'];   // wiped and regenerated on every build
const SITE_URL = 'https://www.janrehacek.com';

const TYPES = ['pronajem', 'prodej', 'investicni'];   // recognized listing categories
const IMG_EXT = /\.(jpe?g|png|webp)$/i;
const COVER_NAME = /^01-uvodni\.(jpe?g|png|webp)$/i;

// Smaller copies of every listing photo: width → JPEG quality.
const VARIANT_DIR = '_nahled';
const VARIANTS = { 800: 72, 320: 70 };

// Frontmatter keys that may hold a map (indented "key: value" lines under them).
const MAP_FIELDS = new Set(['info_extra', 'investment_case']);

const AVAILABLE = new Set(['nova', 'aktivni']);      // counted as "aktivní / aktuální"
const CLOSED = new Set(['prodano', 'pronajato']);    // noindex + left out of sitemap

// Languages that should translate every L.* / T.* key (Czech is the HTML default).
const I18N_LANGS = ['sk', 'en', 'de', 'fr', 'it', 'es', 'pl', 'ru', 'ja', 'zh'];

const HOMEPAGE_FEATURED_MAX = 3;
const DEFAULT_CTA = 'Domluvit prohlídku';

const STATIC_ROUTES = ['/', '/about', '/services', '/housio', '/pro-maklere', '/investors', '/references', '/nabidka', '/contact', '/ochrana-osobnich-udaju'];

// Per-type output configuration for DETAIL pages.
//   outputBase — path under ROOT (and URL path) where `{slug}/index.html` lives
//   template   — which template file in _templates/ to use
const DETAIL_OUTPUT = {
    pronajem:   { outputBase: 'nabidka/pronajem', template: 'listing-detail.html' },
    prodej:     { outputBase: 'nabidka/prodej',   template: 'listing-detail.html' },
    investicni: { outputBase: 'investors',        template: 'listing-detail-investor.html' },
};

// Index pages to generate (each filters listings by type or shows all).
//   outputBase — path under ROOT (and URL path) where `index.html` lives
//   filter     — null = all 'nabidka' types; 'investicni' etc. = single type
//   title      — <title> / og:title (≤ 60 chars)
//   describe   — builds the meta description from the page's available listings
const INDEX_PAGES = [
    { outputBase: 'nabidka',          filter: null,         tab: 'vse',      template: 'listing-index.html',
      eyebrow_key: 'listings.eyebrow.all',  h1_key: 'listings.h1.all',  eyebrow: 'Nabídka nemovitostí',  h1: 'Aktuální nabídka <em>nemovitostí.</em>',
      title: 'Nabídka nemovitostí v Moravskoslezském kraji | Jan Řeháček', describe: describeAll },
    { outputBase: 'nabidka/pronajem', filter: 'pronajem',   tab: 'pronajem', template: 'listing-index.html',
      eyebrow_key: 'listings.eyebrow.rent', h1_key: 'listings.h1.rent', eyebrow: 'Pronájem nemovitostí', h1: 'Aktuální <em>pronájmy.</em>',
      title: 'Pronájem bytů v Moravskoslezském kraji | Jan Řeháček', describe: describeRent },
    { outputBase: 'nabidka/prodej',   filter: 'prodej',     tab: 'prodej',   template: 'listing-index.html',
      eyebrow_key: 'listings.eyebrow.sale', h1_key: 'listings.h1.sale', eyebrow: 'Prodej nemovitostí',   h1: 'Aktuální nabídka <em>k prodeji.</em>',
      title: 'Prodej bytů a domů — Ostrava, Karviná a okolí | Jan Řeháček', describe: describeSale },
    { outputBase: 'investors',        filter: 'investicni', tab: null,       template: 'investors-landing.html',
      eyebrow_key: 'listing.investicni.eyebrow', h1_key: 'listing.investicni.heading', eyebrow: 'INVESTIČNÍ PŘÍLEŽITOSTI', h1: 'Investiční příležitosti pro vážné <em>investory.</em>',
      title: 'Investiční nemovitosti — Ostrava a Karviná | Jan Řeháček', describe: describeInvest },
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

// Recognized body section headings (aliases → canonical). Any other "## heading" fails the build.
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

/**
 * Shared-term i18n attribute for short panel/spec labels & values.
 * Returns ` data-i18n="T.<text>"` only for texts containing a real word
 * (≥3 letters); pure numbers/units/prices (56 m², 3+1, 2 390 000 Kč) get no
 * key and keep the Czech default in every language. Skips texts with chars
 * unsafe for an attribute/key.
 */
function ti(text) {
    if (text == null) return '';
    const s = String(text);
    if (/["<>&]/.test(s)) return '';
    if (!/\p{L}{3,}/u.test(s)) return '';
    return ` data-i18n="T.${s}"`;
}

/** Minimal YAML frontmatter parser. */
function parseFrontmatter(src) {
    const m = src.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
    if (!m) throw new Error('chybí úvodní blok mezi řádky --- (YAML frontmatter)');
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
    const sections = {};
    const headings = [];
    if (!body) return { sections, headings };
    const parts = body.split(/^##\s+/m);
    for (let i = 1; i < parts.length; i++) {
        const [heading, ...rest] = parts[i].split('\n');
        const h = heading.trim();
        headings.push(h);
        const canonical = SECTION_ALIASES[h];
        if (canonical) sections[canonical] = rest.join('\n').trim();
    }
    return { sections, headings };
}

/** Minimal markdown inline: **bold** + *italic* + escape. Safe for body prose. */
function renderInline(s) {
    let out = escapeHtml(s);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    return out;
}

function renderDescription(text, i18nKey) {
    if (!text) return '';
    const ps = text.split(/\n\s*\n/)
        .map(p => p.trim()).filter(Boolean)
        .map(p => '                <p>' + renderInline(p) + '</p>')
        .join('\n');
    if (!i18nKey) return ps;
    return `            <div data-i18n-html="${i18nKey}">\n${ps}\n            </div>`;
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
                <div class="listing-spec-label"${ti(s.label)}>${escapeHtml(s.label)}</div>
                <div class="listing-spec-value"${ti(s.value)}>${escapeHtml(s.value)}</div>
            </div>`;
    }).join('\n');
}

// Canonical info-panel labels → i18n keys (CZ default text is the literal map key).
// Custom info_extra keys from info.md fall through as shared terms (T.*).
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
 * Layout: large price → state badge → property metrics.
 */
function renderInvestorInfoPanel(l) {
    const rows = [];
    if (l.price_per_sqm)        rows.push(['Cena za m²',           l.price_per_sqm, 'listings.info.pricePerSqm']);
    if (l.size_total)           rows.push(['Celková plocha',       l.size_total,    'listings.info.areaTotal']);
    if (l.units != null && l.units !== '') rows.push(['Bytové jednotky', String(l.units), 'listing.detail.units']);
    if (l.occupancy)            rows.push(['Obsazenost',            l.occupancy,     'listings.info.occupancy']);
    if (l.info_extra && typeof l.info_extra === 'object') {
        for (const k of Object.keys(l.info_extra)) rows.push([k, l.info_extra[k]]);
    }
    if (l.declaration_of_owner) rows.push(['Prohlášení vlastníka',  l.declaration_of_owner, 'listing.detail.declaration']);
    if (l.location_long)        rows.push(['Lokalita',              l.location_long, 'listings.info.location']);

    const rowsHtml = rows.map(([label, value, key]) =>
        `                    <div class="listing-info-row">
                        <span class="listing-info-label"${key ? ` data-i18n="${key}"` : ti(label)}>${escapeHtml(label)}</span>
                        <span class="listing-info-value"${ti(value)}>${escapeHtml(value)}</span>
                    </div>`
    ).join('\n');

    // The badge text comes from info.md (e.g. "Po rekonstrukci" / "K rekonstrukci"),
    // so it is translated as a shared term — never through a fixed key.
    const stateBadge = l.state
        ? `                <div class="listing-info-state-row">
                    <span class="listing-info-label" data-i18n="listing.detail.state.label">Stav nemovitosti</span>
                    <span class="listing-info-state-badge"${ti(l.state)}>${escapeHtml(l.state)}</span>
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
function renderHighlights(text, i18nKey) {
    if (!text) return '';
    const items = text.split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('-'))
        .map(l => '                    <li>' + escapeHtml(l.replace(/^-\s*/, '')) + '</li>')
        .join('\n');
    if (!items) return '';
    const hlAttr = i18nKey ? ` data-i18n-html="${i18nKey}"` : '';
    return `        <section class="listing-highlights-section">
            <div class="container">
                <h2 class="section-title" data-i18n="listing.detail.highlights.title">Hlavní výhody projektu</h2>
                <ul class="listing-highlights"${hlAttr}>
${items}
                </ul>
            </div>
        </section>`;
}

/** Investment-case dark box (uses frontmatter investment_case map). */
function renderInvestmentCase(ic) {
    if (!ic || typeof ic !== 'object') return '';
    const rows = [];
    // gross_margin = estimated resale − purchase price; renovation costs are NOT deducted,
    // so it must not be called "marže".
    if (ic.buy_price_per_sqm)    rows.push(['Cena za m² (nákup)',                     ic.buy_price_per_sqm,    false, 'listing.detail.ic.buy']);
    if (ic.market_price_per_sqm) rows.push(['Tržní cena za m² po rekonstrukci',       ic.market_price_per_sqm, false, 'listing.detail.ic.market']);
    if (ic.estimated_resale)     rows.push(['Předpokládaná prodejní cena',            ic.estimated_resale,     false, 'listing.detail.ic.resale']);
    if (ic.gross_margin)         rows.push(['Rozdíl proti odhadované prodejní ceně',  ic.gross_margin,         true,  'listing.detail.ic.diff']);
    if (!rows.length) return '';
    const rowsHtml = rows.map(([label, value, highlight, key]) =>
        `                    <div class="investment-case-row${highlight ? ' is-highlight' : ''}">
                        <span class="investment-case-label" data-i18n="${key}">${escapeHtml(label)}</span>
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
function renderInvestmentIntent(text, i18nKey) {
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
                <div class="listing-intent-body"${i18nKey ? ` data-i18n-html="${i18nKey}"` : ''}>
${html}
                </div>
            </div>
        </section>`;
}

/** Generic "Stav nemovitosti" prose section. */
function renderStateDescription(text, i18nKey) {
    if (!text) return '';
    const html = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
        .map(p => '                <p>' + renderInline(p) + '</p>').join('\n');
    return `        <section class="listing-state-section">
            <div class="container">
                <h2 class="section-title" data-i18n="listing.detail.state.title">Stav nemovitosti</h2>
                <div class="listing-state-body"${i18nKey ? ` data-i18n-html="${i18nKey}"` : ''}>
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

    const labelAttr = (label) => INFO_LABEL_I18N[label] ? ` data-i18n="${INFO_LABEL_I18N[label]}"` : ti(label);

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
                        <span class="listing-info-value"${ti(value)}>${escapeHtml(value)}</span>
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

// `_nahled/` and other sub-folders are skipped: only files with an image extension count.
function listImages(slug, type) {
    const dir = path.join(LISTINGS_DIR, type, slug);
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => e.isFile() && IMG_EXT.test(e.name))
        .map(e => e.name)
        .sort();
}

function findCover(images) {
    const exact = images.find(f => COVER_NAME.test(f));
    return exact || images[0] || null;
}

// ===== IMAGES: dimensions, URLs, smaller variants =====

/** Width/height from the file header (JPEG SOFn, PNG IHDR, WebP VP8/VP8L/VP8X). null if unknown. */
function parseImageSize(buf) {
    // PNG
    if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // WebP
    if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
        const chunk = buf.toString('ascii', 12, 16);
        if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
        if (chunk === 'VP8L') {
            const b = buf.readUInt32LE(21);
            return { width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1 };
        }
        if (chunk === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
        return null;
    }
    // JPEG — walk the segments until a Start-Of-Frame marker
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
        let i = 2;
        let orientation = 1;
        while (i + 9 < buf.length) {
            if (buf[i] !== 0xff) { i++; continue; }
            const marker = buf[i + 1];
            if (marker === 0xff) { i++; continue; }                                   // fill byte
            if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }  // no length
            if (marker === 0xd9 || marker === 0xda) break;                           // EOI / scan data
            const len = buf.readUInt16BE(i + 2);
            if (marker === 0xe1 && buf.toString('latin1', i + 4, i + 10) === 'Exif\0\0') {
                orientation = exifOrientation(buf, i + 10, i + 2 + len);
            }
            const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
            if (isSOF) {
                const h = buf.readUInt16BE(i + 5);
                const w = buf.readUInt16BE(i + 7);
                // EXIF orientation 5–8 = rotated 90°: browsers display it with swapped sides
                return orientation >= 5 && orientation <= 8 ? { width: h, height: w } : { width: w, height: h };
            }
            i += 2 + len;
        }
    }
    return null;
}

function exifOrientation(buf, tiff, end) {
    try {
        const le = buf.toString('ascii', tiff, tiff + 2) === 'II';
        const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
        const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
        const ifd = tiff + u32(tiff + 4);
        if (ifd + 2 > end) return 1;
        const n = u16(ifd);
        for (let k = 0; k < n; k++) {
            const e = ifd + 2 + k * 12;
            if (e + 12 > end) break;
            if (u16(e) === 0x0112) return u16(e + 8);
        }
    } catch (e) { /* malformed EXIF → assume upright */ }
    return 1;
}

/**
 * Remove the EXIF block (camera data incl. GPS coordinates) from a generated JPEG copy.
 * Skipped when the photo is stored rotated (EXIF orientation ≠ 1), because the
 * orientation flag lives in that block. Returns true when the file was rewritten.
 */
function stripExif(file) {
    const buf = fs.readFileSync(file);
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return false;
    const keep = [buf.subarray(0, 2)];
    let i = 2, stripped = false;
    while (i + 4 <= buf.length && buf[i] === 0xff) {
        const marker = buf[i + 1];
        if (marker === 0xda) break;                        // start of image data: copy the rest as is
        const len = buf.readUInt16BE(i + 2);
        const isExif = marker === 0xe1 && buf.toString('latin1', i + 4, i + 10) === 'Exif\0\0';
        if (isExif && exifOrientation(buf, i + 10, i + 2 + len) !== 1) return false;
        if (isExif) stripped = true;
        else keep.push(buf.subarray(i, i + 2 + len));
        i += 2 + len;
    }
    if (!stripped) return false;
    keep.push(buf.subarray(i));
    fs.writeFileSync(file, Buffer.concat(keep));
    return true;
}

const _sizeCache = new Map();
function imageSize(file) {
    if (_sizeCache.has(file)) return _sizeCache.get(file);
    let dim = null;
    try { dim = parseImageSize(fs.readFileSync(file)); } catch (e) { dim = null; }
    _sizeCache.set(file, dim);
    return dim;
}

function mimeOf(file) {
    if (/\.png$/i.test(file)) return 'image/png';
    if (/\.webp$/i.test(file)) return 'image/webp';
    return 'image/jpeg';
}

const imgPath = (l, file) => path.join(LISTINGS_DIR, l.type, l.slug, file);
const imgUrl  = (l, file) => `/images/listings/${l.type}/${l.slug}/${encodeURIComponent(file)}`;
const variantName = (file, w) => `${file.replace(IMG_EXT, '')}-${w}.jpg`;

/** The smaller copy of a photo, if it exists: { url, width, height } — else null. */
function variant(l, file, w) {
    const name = variantName(file, w);
    const abs = path.join(LISTINGS_DIR, l.type, l.slug, VARIANT_DIR, name);
    if (!fs.existsSync(abs)) return null;
    const dim = imageSize(abs) || {};
    return { url: `/images/listings/${l.type}/${l.slug}/${VARIANT_DIR}/${encodeURIComponent(name)}`, width: dim.width, height: dim.height };
}

const dimsAttr = (d) => (d && d.width && d.height ? ` width="${d.width}" height="${d.height}"` : '');

/**
 * Create missing _nahled/<name>-800.jpg and -320.jpg for every listing photo
 * (macOS `sips`; elsewhere just report what is missing — pages fall back to originals).
 * Re-runnable: existing files are kept; copies of deleted photos are removed.
 */
function generateVariants(listings) {
    const canSips = process.platform === 'darwin' && fs.existsSync('/usr/bin/sips');
    let made = 0, missing = 0, removed = 0;
    for (const l of listings) {
        const dir = path.join(LISTINGS_DIR, l.type, l.slug);
        const outDir = path.join(dir, VARIANT_DIR);
        const wanted = new Set();
        const byBase = new Map();
        for (const file of l.gallery) {
            const base = file.replace(IMG_EXT, '');
            if (byBase.has(base)) {
                console.warn(`  ⚠ ${l.type}/${l.slug}: "${byBase.get(base)}" a "${file}" mají stejné jméno — náhled bude jen pro jednu z nich`);
            }
            byBase.set(base, file);
            const src = path.join(dir, file);
            const dim = imageSize(src);
            for (const [w, quality] of Object.entries(VARIANTS)) {
                const name = variantName(file, w);
                wanted.add(name);
                const out = path.join(outDir, name);
                if (fs.existsSync(out)) continue;
                if (!canSips) { missing++; continue; }
                fs.mkdirSync(outDir, { recursive: true });
                const args = ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality)];
                if (!dim || dim.width > Number(w)) args.push('--resampleWidth', String(w));   // never upscale
                args.push(src, '--out', out);
                try {
                    execFileSync('sips', args, { stdio: 'ignore' });
                    stripExif(out);   // sips copies EXIF incl. GPS; the copies don't need it
                    made++;
                } catch (e) {
                    console.warn(`  ⚠ ${l.type}/${l.slug}/${file}: náhled ${w}px se nepodařilo vytvořit (${e.message})`);
                }
            }
        }
        if (fs.existsSync(outDir)) {
            for (const f of fs.readdirSync(outDir)) {
                if (!f.startsWith('.') && !wanted.has(f)) { fs.rmSync(path.join(outDir, f), { force: true }); removed++; }
            }
        }
    }
    if (made) console.log(`  → vytvořeno ${made} nových náhledů v ${VARIANT_DIR}/`);
    if (removed) console.log(`  → smazáno ${removed} náhledů po odstraněných fotkách`);
    if (missing) console.warn(`  ⚠ chybí ${missing} náhledů (${VARIANT_DIR}/) — spusťte "node build.js" na Macu a nahrajte je; zatím se použijí originály`);
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
 * Hero tile = original photo (high priority); small tiles = 800px copies.
 * Full image list is embedded as JSON in data-gallery for the lightbox JS
 * (`src` = original, `thumb` = 320px copy for the lightbox strip).
 */
function renderGallery(l, heroRibbon) {
    const images = l.gallery;
    if (!images.length) return '            <!-- No gallery photos -->';
    const title = l.title;
    const titleEsc = escapeHtml(title);
    const visible = images.slice(0, 5);
    const remaining = Math.max(0, images.length - visible.length);

    // Lightbox payload — every image with a readable alt and a watermark flag.
    const galleryData = images.map((file, i) => {
        const item = { src: imgUrl(l, file) };
        const thumb = variant(l, file, 320);
        if (thumb) item.thumb = thumb.url;
        item.alt = i === 0 ? title : `${title} — foto ${i + 1}`;
        item.watermark = i === 0 && l.cover_is_visualization;
        return item;
    });
    const dataAttr = escapeHtml(JSON.stringify(galleryData));

    const watermarkBadge = '<span class="listing-watermark" aria-hidden="true" data-i18n="listing.detail.visualization_badge">Vizualizace po rekonstrukci</span>';

    const tiles = visible.map((file, i) => {
        const alt  = i === 0 ? titleEsc : `${titleEsc} — foto ${i + 1}`;
        const hero = i === 0 ? ' is-hero' : '';
        const img  = i === 0
            ? `<img src="${imgUrl(l, file)}" alt="${alt}" loading="eager" fetchpriority="high">`
            : `<img src="${(variant(l, file, 800) || {}).url || imgUrl(l, file)}" alt="${alt}" loading="lazy" decoding="async">`;
        const showOverlay = (i === visible.length - 1) && remaining > 0;
        const wm = i === 0 && l.cover_is_visualization ? `\n                ${watermarkBadge}` : '';
        const rb = i === 0 && heroRibbon ? `\n                ${heroRibbon}` : '';
        return `            <button type="button" class="listing-gallery-item${hero}" data-gallery-open data-index="${i}" aria-label="Otevřít fotku ${i + 1} z ${images.length}">
                ${img}${wm}${rb}${showOverlay ? `
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

/** Card cover: 800px copy + srcset with the original; falls back to the original alone. */
function cardImage(l) {
    if (!l.cover) return { src: '/images/og-default.jpg', srcset: '', dims: '' };
    const orig = imgUrl(l, l.cover);
    const origDim = imageSize(imgPath(l, l.cover));
    const v = variant(l, l.cover, 800);
    if (!v) return { src: orig, srcset: '', dims: dimsAttr(origDim) };
    const srcset = origDim && v.width && v.width < origDim.width
        ? ` srcset="${v.url} ${v.width}w, ${orig} ${origDim.width}w" sizes="(max-width: 700px) 92vw, 400px"`
        : '';
    return { src: v.url, srcset, dims: dimsAttr(v) };
}

function listingUrl(l) {
    return `/${DETAIL_OUTPUT[l.type].outputBase}/${l.slug}`;
}

function renderCard(l, cardTpl) {
    const img = cardImage(l);
    return renderTemplate(cardTpl, {
        href: listingUrl(l),
        title: escapeHtml(l.title),
        title_key: `L.${l.type}.${l.slug}.title`,
        price: escapeHtml(l.price),
        location_short: escapeHtml(l.location_short),
        short_description: escapeHtml(l.short_description),
        short_key: `L.${l.type}.${l.slug}.short`,
        cover_src: img.src,
        cover_srcset: img.srcset,
        cover_dims: img.dims,
        cover_alt: escapeHtml(l.title),
        cover_watermark: l.cover_is_visualization
            ? '                    <span class="listing-watermark listing-watermark-card" aria-hidden="true" data-i18n="listing.detail.visualization_badge">Vizualizace po rekonstrukci</span>'
            : '',
        badge: renderCardBadge(l),
        meta_line: renderCardMeta(l),
    });
}

// ===== DETAIL-PAGE PIECES =====

/** Parent pages of a listing, shared by visible breadcrumbs and JSON-LD. */
function breadcrumbTrail(l) {
    const trail = [{ name: 'Domů', path: '/', key: 'nav.home' }];
    if (l.type === 'investicni') {
        trail.push({ name: 'Pro investory', path: '/investors', key: 'nav.investors' });
    } else {
        trail.push({ name: 'Nabídka', path: '/nabidka', key: 'nav.listings' });
        trail.push(l.type === 'pronajem'
            ? { name: 'Pronájem', path: '/nabidka/pronajem', key: 'listings.tabs.rent' }
            : { name: 'Prodej',   path: '/nabidka/prodej',   key: 'listings.tabs.sale' });
    }
    return trail;
}

function renderBreadcrumbs(l) {
    const links = breadcrumbTrail(l).map(c => `<a href="${c.path}" data-i18n="${c.key}">${escapeHtml(c.name)}</a>`);
    return `<nav class="breadcrumbs" aria-label="Drobečková navigace">${links.join('<span aria-hidden="true">/</span>')}</nav>`;
}

/** Contact button: custom `cta:` text from info.md (shared-term key) or the default key. */
function renderCtaButton(l) {
    const custom = l.cta && l.cta.trim() !== DEFAULT_CTA ? l.cta.trim() : '';
    return custom
        ? `<a href="/contact" class="btn btn-primary"${ti(custom)}>${escapeHtml(custom)}</a>`
        : `<a href="/contact" class="btn btn-primary" data-i18n="listing.detail.cta.viewing">${DEFAULT_CTA}</a>`;
}

/** Link between the two pages of a property listed both for sale and for investors. */
function renderCrosslink(l, dupSlugs) {
    if (!dupSlugs.has(l.slug)) return '';
    if (l.type === 'prodej') {
        return `\n        <p class="listing-crosslink"><a href="/investors/${l.slug}" data-i18n="listings.crosslink.toInvest">Tuto nemovitost najdete i mezi investičními příležitostmi — s výnosem a investičními čísly →</a></p>`;
    }
    if (l.type === 'investicni') {
        return `\n        <p class="listing-crosslink"><a href="/nabidka/prodej/${l.slug}" data-i18n="listings.crosslink.toSale">Tato nemovitost je i v běžné nabídce k prodeji →</a></p>`;
    }
    return '';
}

/** "2 420 000 Kč" → 2420000. null when there is no plain number (e.g. "Cena na vyžádání", "2,5 mil."). */
function priceNumber(s) {
    const str = String(s || '');
    const m = str.match(/\d{1,3}(?:[  .]\d{3})+(?!\d)|\d+/);
    if (!m) return null;
    const after = str.slice(m.index + m[0].length);
    if (/^,\d/.test(after) || /mil|tis/i.test(str)) return null;   // decimals / abbreviations → don't guess
    return Number(m[0].replace(/\D/g, ''));
}

/** Floor area in m² for structured data: `area:` or a plain "56 m²" size_total. */
function areaNumber(l) {
    let v = null;
    if (l.area !== '' && l.area != null) v = parseFloat(String(l.area).replace(',', '.'));
    else {
        const m = String(l.size_total || '').match(/^\s*(\d+(?:[.,]\d+)?)\s*m²\s*$/);
        if (m) v = parseFloat(m[1].replace(',', '.'));
    }
    return Number.isFinite(v) ? v : null;
}

function buildJsonLd(l, canonical, imageUrl) {
    const availability = CLOSED.has(l.status) ? 'https://schema.org/SoldOut'
        : l.status === 'rezervovano' ? 'https://schema.org/LimitedAvailability'
        : 'https://schema.org/InStock';
    const price = priceNumber(l.price);
    const offer = { '@type': 'Offer', priceCurrency: 'CZK', availability };
    if (price != null) {
        if (l.type === 'pronajem') {
            offer.priceSpecification = { '@type': 'UnitPriceSpecification', price, priceCurrency: 'CZK', unitCode: 'MON' };
        } else {
            offer.price = price;
        }
    }

    const listing = { '@type': 'RealEstateListing', name: l.title };
    if (l.short_description) listing.description = l.short_description;
    listing.url = canonical;
    if (imageUrl) listing.image = imageUrl;
    listing.offers = offer;
    // RealEstateListing je typ stránky — adresa a plocha patří samotné nemovitosti (about)
    const property = { '@type': 'Accommodation', name: l.title };
    const locality = l.location_short || l.location_long;
    if (locality) property.address = { '@type': 'PostalAddress', addressLocality: locality, addressCountry: 'CZ' };
    const area = areaNumber(l);
    if (area != null) property.floorSize = { '@type': 'QuantitativeValue', value: area, unitCode: 'MTK' };
    if (property.address || property.floorSize) listing.about = property;

    const crumbs = breadcrumbTrail(l).concat([{ name: l.title, path: listingUrl(l) }]);
    const breadcrumbs = {
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: SITE_URL + c.path })),
    };

    return JSON.stringify({ '@context': 'https://schema.org', '@graph': [listing, breadcrumbs] })
        .replace(/<\//g, '<\\/');
}

function ogImage(l) {
    const file = l.cover ? imgPath(l, l.cover) : path.join(ROOT, 'images', 'og-default.jpg');
    const url = SITE_URL + (l.cover ? imgUrl(l, l.cover) : '/images/og-default.jpg');
    const dim = imageSize(file);
    if (!dim) console.warn(`  ⚠ ${l.type}/${l.slug}: nelze zjistit rozměry úvodní fotky`);
    return { url, width: dim ? dim.width : '', height: dim ? dim.height : '', type: mimeOf(file) };
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

// ===== INDEX-PAGE META DESCRIPTIONS (built from the listings on the page) =====

function pluralCz(n, one, few, many) {
    if (n === 1) return one;
    if (n >= 2 && n <= 4) return few;
    return many;
}

/** "2 290 000" → "2,29 mil. Kč";  13900 → "13 900 Kč" */
function formatCzk(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '').replace('.', ',') + ' mil. Kč';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Kč';
}

function minPrice(ls) {
    const prices = ls.map(l => priceNumber(l.price)).filter(n => n != null);
    return prices.length ? Math.min(...prices) : null;
}

/** "Karviná — ČSL. armády" → "Karviná";  "Ostrava-Poruba — Oty Synka" → "Ostrava" */
function cityOf(l) {
    const s = l.location_short || l.location_long || '';
    return s.split(/\s*[—–,]\s*|\s+-\s+/)[0].split('-')[0].trim();
}

/** Cities of the listings, most frequent first (ties: build order), max 4 + "a okolí". */
function citiesText(ls) {
    const count = new Map();
    for (const l of ls) {
        const c = cityOf(l);
        if (c) count.set(c, (count.get(c) || 0) + 1);
    }
    const cities = [...count.keys()].sort((a, b) => count.get(b) - count.get(a));
    if (cities.length > 4) return cities.slice(0, 4).join(', ') + ' a okolí';
    if (cities.length <= 1) return cities[0] || '';
    return cities.slice(0, -1).join(', ') + ' a ' + cities[cities.length - 1];
}

function describeAll(avail) {
    const n = avail.length;
    if (!n) return 'Aktuální nabídka bytů a domů k prodeji i pronájmu v Moravskoslezském kraji od Jana Řeháčka — investora a realitního experta.';
    const sale = minPrice(avail.filter(l => l.type === 'prodej'));
    const rent = minPrice(avail.filter(l => l.type === 'pronajem'));
    const prices = [
        sale != null ? `prodej od ${formatCzk(sale)}` : '',
        rent != null ? `pronájem od ${formatCzk(rent)} měsíčně` : '',
    ].filter(Boolean).join(', ');
    return `Byty a domy k prodeji i pronájmu — ${citiesText(avail)}. ${n} ${pluralCz(n, 'aktuální nabídka', 'aktuální nabídky', 'aktuálních nabídek')}${prices ? ': ' + prices : ''}.`;
}

function describeSale(avail) {
    const n = avail.length;
    if (!n) return 'Byty a domy na prodej v Moravskoslezském kraji od Jana Řeháčka — investora a realitního experta. Nové nabídky zde zveřejňujeme průběžně.';
    const min = minPrice(avail);
    const price = min == null ? '' : (n === 1 ? ` za ${formatCzk(min)}` : ` s cenou od ${formatCzk(min)}`);
    return `Byty a domy na prodej — ${citiesText(avail)}. ${n} ${pluralCz(n, 'aktuální nabídka', 'aktuální nabídky', 'aktuálních nabídek')}${price}. Fotografie a podrobný popis u každé nabídky.`;
}

function describeRent(avail) {
    const n = avail.length;
    if (!n) return 'Pronájem bytů v Moravskoslezském kraji od Jana Řeháčka — investora a realitního experta. Nové nabídky zde zveřejňujeme průběžně.';
    const min = minPrice(avail);
    const price = min == null ? '' : (n === 1 ? `, nájem ${formatCzk(min)} měsíčně` : `, nájem od ${formatCzk(min)} měsíčně`);
    const noCommission = avail.every(l => /^0\s*Kč$|bez provize/i.test(String(l.commission).trim()));
    return `Pronájem bytů v Moravskoslezském kraji — ${citiesText(avail)}. ${n} ${pluralCz(n, 'aktuální nabídka', 'aktuální nabídky', 'aktuálních nabídek')}${price}${noCommission ? ', bez provize' : ''}. Fotografie a podrobný popis u každé nabídky.`;
}

function describeInvest(avail) {
    const n = avail.length;
    if (!n) return 'Investiční nemovitosti pro vážné investory — činžovní domy, bytové jednotky a celé projekty s důrazem na výnos a likviditu.';
    const min = minPrice(avail);
    const price = min == null ? '' : ` s cenou od ${formatCzk(min)}`;
    return `Investiční nemovitosti — ${citiesText(avail)}. ${n} ${pluralCz(n, 'aktivní příležitost', 'aktivní příležitosti', 'aktivních příležitostí')}${price}, s důrazem na výnos a likviditu.`;
}

/** Big category-choice cards shown only on /nabidka root, above the secondary filter tabs. */
function renderCategoryCards(counts) {
    return `        <div class="category-choice">
            <a href="/nabidka/pronajem" class="category-card">
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
            <a href="/nabidka/prodej" class="category-card">
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
            ${tab('vse',      '/nabidka',          'Vše',      'listings.tabs.all')}
            ${tab('pronajem', '/nabidka/pronajem', 'Pronájem', 'listings.tabs.rent')}
            ${tab('prodej',   '/nabidka/prodej',   'Prodej',   'listings.tabs.sale')}
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

/**
 * Read + validate one listing. Problems are pushed to `errors` (the build
 * stops after reading all listings, so every problem is reported at once).
 */
function readListing(type, slug, errors) {
    const rel = `images/listings/${type}/${slug}/info.md`;
    const infoPath = path.join(ROOT, rel);
    if (!fs.existsSync(infoPath)) {
        errors.push(`${rel}: soubor chybí`);
        return null;
    }
    let parsed;
    try {
        parsed = parseFrontmatter(fs.readFileSync(infoPath, 'utf8'));
    } catch (e) {
        errors.push(`${rel}: ${e.message}`);
        return null;
    }
    const { data, body } = parsed;
    const { sections, headings } = parseSections(body);

    // (a) "price:" with nothing after it parses as an empty map → "[object Object]" on the page
    for (const [key, val] of Object.entries(data)) {
        if (val && typeof val === 'object' && !MAP_FIELDS.has(key)) {
            errors.push(`${rel}: pole "${key}" nemá hodnotu — napište ji na stejný řádek (např. "${key}: …"), nebo řádek smažte`);
        }
    }
    // (b) unknown "## heading" → its text would silently disappear from the page
    for (const h of headings) {
        if (!SECTION_ALIASES[h]) {
            errors.push(`${rel}: neznámý nadpis "## ${h}" — povolené nadpisy: ${Object.keys(SECTION_ALIASES).map(x => `"${x}"`).join(', ')}`);
        }
    }
    // (c) required fields
    for (const f of ['title', 'price']) {
        if (data[f] == null || (typeof data[f] === 'string' && !data[f].trim())) {
            errors.push(`${rel}: chybí povinné pole "${f}"`);
        }
    }

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

    const str = (v) => (typeof v === 'string' ? v : '');
    return {
        slug,
        type,
        title: str(data.title) || slug,
        status: str(data.status) || 'aktivni',
        order: (data.order != null && data.order !== '') ? Number(data.order) : null,
        price: str(data.price) || 'Cena na vyžádání',
        deposit: str(data.deposit),
        commission: str(data.commission),
        available_from: str(data.available_from),
        location: str(data.location),
        location_short: str(data.location_short) || str(data.location),
        location_long: str(data.location_long) || str(data.location_short) || str(data.location),
        disposition: str(data.disposition),
        area: str(data.area),
        floor: str(data.floor),
        building_type: str(data.building_type),
        ownership: str(data.ownership),
        condition: str(data.condition),
        short_description: str(data.short_description),
        info_extra: data.info_extra || null,
        // Investicni-specific frontmatter fields
        price_per_sqm: str(data.price_per_sqm),
        size_total: str(data.size_total),
        units: str(data.units),
        state: str(data.state),
        occupancy: str(data.occupancy),
        declaration_of_owner: str(data.declaration_of_owner),
        cta: str(data.cta),
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

/** All listings, validated and sorted. Exits with code 1 when any info.md is broken. */
function loadListings() {
    if (!fs.existsSync(LISTINGS_DIR)) {
        console.error(`✗ Listings folder missing: ${LISTINGS_DIR}`);
        process.exit(1);
    }
    const errors = [];
    const listings = [];
    for (const type of TYPES) {
        const typeDir = path.join(LISTINGS_DIR, type);
        if (!fs.existsSync(typeDir)) continue;
        const slugs = fs.readdirSync(typeDir)
            .filter(f => !f.startsWith('_') && !f.startsWith('.'))
            .filter(f => fs.statSync(path.join(typeDir, f)).isDirectory())
            .sort();   // same order on every machine (Linux readdir order is not alphabetical)
        for (const slug of slugs) {
            const l = readListing(type, slug, errors);
            if (l) listings.push(l);
        }
    }
    if (errors.length) {
        console.error(`✗ Build zastaven — ${errors.length} ${pluralCz(errors.length, 'chyba', 'chyby', 'chyb')} v info.md:`);
        for (const e of errors) console.error(`  • ${e}`);
        process.exit(1);
    }

    // Sort by status group, then by explicit `order` (lower = earlier; default 100).
    // Stable sort keeps the alphabetical order for listings without `order`.
    listings.sort((a, b) => {
        const ai = STATUS_ORDER.indexOf(a.status);
        const bi = STATUS_ORDER.indexOf(b.status);
        const sa = ai === -1 ? 99 : ai;
        const sb = bi === -1 ? 99 : bi;
        if (sa !== sb) return sa - sb;
        const oa = (a.order != null && !Number.isNaN(a.order)) ? a.order : 100;
        const ob = (b.order != null && !Number.isNaN(b.order)) ? b.order : 100;
        return oa - ob;
    });
    return listings;
}

/**
 * Homepage: replace everything between <!-- NABIDKY:START --> and <!-- NABIDKY:END -->
 * with cards of up to 3 available investment listings. Writes only when something changed.
 */
function updateHomepage(listings, cardTpl, file = HOMEPAGE_PATH) {
    if (!fs.existsSync(file)) return false;
    const src = fs.readFileSync(file, 'utf8');
    const re = /(<!-- NABIDKY:START -->)[\s\S]*?\n?([ \t]*)(<!-- NABIDKY:END -->)/;
    if (!re.test(src)) {
        console.log(`  · ${path.basename(file)}: značky <!-- NABIDKY:START --> / <!-- NABIDKY:END --> nenalezeny — doporučené nabídky přeskočeny`);
        return false;
    }
    const featured = listings
        .filter(l => l.type === 'investicni' && AVAILABLE.has(l.status))
        .slice(0, HOMEPAGE_FEATURED_MAX);
    const cards = featured.map(l => renderCard(l, cardTpl)).join('\n');
    const out = src.replace(re, (m, start, indent, end) => `${start}\n${cards ? cards + '\n' : ''}${indent}${end}`);
    if (out === src) {
        console.log(`  · ${path.basename(file)}: doporučené nabídky beze změny (${featured.length})`);
        return true;
    }
    fs.writeFileSync(file, out);
    console.log(`  → ${path.basename(file)}: doporučené nabídky aktualizovány (${featured.length} ${pluralCz(featured.length, 'karta', 'karty', 'karet')})`);
    return true;
}

/** Evaluate assets/script.js + assets/listings-i18n.js in a sandbox and return window.translations. */
function loadTranslations() {
    const noop = () => {};
    const el = { classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, style: {},
                 setAttribute: noop, getAttribute: () => null, addEventListener: noop, appendChild: noop };
    const ctx = {
        document: {
            querySelectorAll: () => [], querySelector: () => null, getElementById: () => null,
            addEventListener: noop, createElement: () => el, body: el,
            documentElement: { setAttribute: noop, getAttribute: () => 'cs' },
        },
        navigator: { language: 'cs', languages: ['cs'] },
        localStorage: { getItem: () => null, setItem: noop },
        location: { href: '', pathname: '/', search: '', hash: '' },
        console: { log: noop, warn: noop, error: noop },
        setTimeout: noop, clearTimeout: noop, setInterval: noop, requestAnimationFrame: noop,
        matchMedia: () => ({ matches: false, addEventListener: noop }),
        Intl,
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    for (const f of ['assets/script.js', 'assets/listings-i18n.js']) {
        try {
            vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f, timeout: 5000 });
        } catch (e) {
            // Runtime DOM code may fail in the sandbox; the dictionaries are assigned before it.
        }
    }
    return ctx.translations || {};
}

/** Warn (never fail) about L.* / T.* keys used in generated pages that some language lacks. */
function checkTranslations(htmlFiles) {
    const dict = loadTranslations();
    if (!Object.keys(dict).length) {
        console.warn('  ⚠ i18n: slovníky se nepodařilo načíst — kontrola překladů přeskočena');
        return;
    }
    const keys = new Set();
    const re = /data-i18n(?:-html)?="([LT]\.[^"]*)"/g;
    for (const f of htmlFiles) {
        for (const m of fs.readFileSync(f, 'utf8').matchAll(re)) keys.add(m[1]);
    }
    const missing = [];
    for (const k of [...keys].sort()) {
        const langs = I18N_LANGS.filter(lang => !(dict[lang] && Object.prototype.hasOwnProperty.call(dict[lang], k)));
        if (langs.length) missing.push({ k, langs });
    }
    if (!missing.length) {
        console.log(`  ✓ i18n: všech ${keys.size} klíčů L.* / T.* je přeloženo do ${I18N_LANGS.length} jazyků`);
        return;
    }
    console.warn(`  ⚠ i18n: ${missing.length} z ${keys.size} klíčů L.* / T.* chybí v některém jazyce (zobrazí se česky):`);
    for (const { k, langs } of missing.slice(0, 20)) {
        console.warn(`      ${k}  [${langs.length === I18N_LANGS.length ? 'všechny jazyky' : langs.join(', ')}]`);
    }
    if (missing.length > 20) console.warn(`      … a dalších ${missing.length - 20}`);
}

/**
 * dist/ = only what the public may see (no README, build.js, templates, info.md).
 * HTML copies get ?v=<sha1:8> on local /assets/*.css|js and /images/*.jpg|png|webp URLs
 * so those files can be cached forever.
 */
function buildDist() {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
    fs.mkdirSync(DIST_DIR, { recursive: true });

    const SKIP_ROOT = new Set(['README.md', 'build.js', 'vercel.json', 'package.json', 'package-lock.json']);
    const PUBLIC_IMG = /\.(jpe?g|png|webp|gif|svg|ico)$/i;
    const ASSET_URL = /(?<=["'\s,(;=]|janrehacek\.com)\/(?:assets\/[^"'\s?#&<>()]+?\.(?:css|js)|images\/[^"'\s?#&<>()]+?\.(?:jpe?g|png|webp))(?![\w.?%\/-])/gi;
    const stats = { files: 0, bytes: 0, versioned: 0 };
    const unresolved = new Set();
    const hashes = new Map();

    const hashOf = (urlPath) => {
        if (hashes.has(urlPath)) return hashes.get(urlPath);
        let rel = urlPath;
        try { rel = decodeURIComponent(urlPath); } catch (e) { /* keep as is */ }
        const file = path.join(ROOT, rel);
        let h = null;
        if (file.startsWith(ROOT + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
            h = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
        }
        hashes.set(urlPath, h);
        return h;
    };
    const versionUrls = (html) => html.replace(ASSET_URL, (u) => {
        const h = hashOf(u);
        if (!h) { unresolved.add(u); return u; }
        stats.versioned++;
        return `${u}?v=${h}`;
    });
    const copy = (rel) => {
        const src = path.join(ROOT, rel);
        const dest = path.join(DIST_DIR, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (/\.html$/i.test(rel)) {
            const out = versionUrls(fs.readFileSync(src, 'utf8'));
            fs.writeFileSync(dest, out);
            stats.bytes += Buffer.byteLength(out);
        } else {
            fs.copyFileSync(src, dest);
            stats.bytes += fs.statSync(src).size;
        }
        stats.files++;
    };
    const walk = (relDir, accept) => {
        const abs = path.join(ROOT, relDir);
        if (!fs.existsSync(abs)) return;
        for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
            if (e.name.startsWith('.')) continue;
            const rel = path.join(relDir, e.name);
            if (e.isDirectory()) walk(rel, accept);
            else if (e.isFile() && accept(e.name)) copy(rel);
        }
    };

    for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
        if (e.isFile() && !e.name.startsWith('.') && !SKIP_ROOT.has(e.name)) copy(e.name);
    }
    walk('assets', () => true);
    walk('nabidka', () => true);
    walk('investors', () => true);
    walk('images', (name) => PUBLIC_IMG.test(name));

    if (unresolved.size) {
        console.warn(`  ⚠ dist: ${unresolved.size} odkazů na neexistující soubory (bez ?v=): ${[...unresolved].slice(0, 5).join(', ')}`);
    }
    console.log(`  → dist/: ${stats.files} souborů, ${(stats.bytes / 1048576).toFixed(1)} MB, ${stats.versioned} URL s ?v=`);
}

// ===== BUILD =====
function build() {
    const listings = loadListings();
    console.log(`Found ${listings.length} listing(s): ${listings.map(l => `${l.type}/${l.slug}`).join(', ')}`);

    generateVariants(listings);

    // Start from empty output folders so a deleted listing leaves no page behind.
    for (const d of GENERATED_DIRS) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });

    const written = [];
    const cardTpl = readTemplate('listing-card.html');
    const tplCache = {};
    const tpl = (name) => (tplCache[name] = tplCache[name] || readTemplate(name));

    // Slugs listed both for sale and for investors → cross-link the two pages
    const slugsOf = (type) => new Set(listings.filter(l => l.type === type).map(l => l.slug));
    const investSlugs = slugsOf('investicni');
    const dupSlugs = new Set([...slugsOf('prodej')].filter(s => investSlugs.has(s)));

    // Detail pages — output path + template depend on listing type
    for (const l of listings) {
        const cfg = DETAIL_OUTPUT[l.type];
        if (!cfg) { console.warn(`  ⚠ ${l.type}/${l.slug}: no DETAIL_OUTPUT config`); continue; }
        const dir = path.join(ROOT, cfg.outputBase, l.slug);
        fs.mkdirSync(dir, { recursive: true });

        const canonical = SITE_URL + listingUrl(l);
        const og = ogImage(l);
        const isInvest = l.type === 'investicni';
        const reservedRibbon = l.status === 'rezervovano'
            ? '<span class="listing-ribbon" data-i18n="listings.status.reserved">REZERVOVÁNO</span>'
            : '';
        const kp = `L.${l.type}.${l.slug}`;   // i18n key prefix for this listing's translatable content

        const html = renderTemplate(tpl(cfg.template), {
            slug: l.slug,
            type: l.type,
            type_label: TYPE_LABEL[l.type] || '',
            title: escapeHtml(l.title),
            // Přípona se jménem jen když se titulek vejde do ~60 znaků, které Google ukáže
            page_title: escapeHtml((l.title + ' | Jan Řeháček').length <= 60 ? l.title + ' | Jan Řeháček' : l.title),
            title_key: `${kp}.title`,
            price: escapeHtml(l.price),
            location_short: escapeHtml(l.location_short),
            location_long: escapeHtml(l.location_long),
            disposition: escapeHtml(l.disposition),
            area: escapeHtml(l.area + ' m²'),
            floor: escapeHtml(l.floor || ''),
            short_description: escapeHtml(l.short_description),
            robots_meta: CLOSED.has(l.status) ? '\n<meta name="robots" content="noindex, follow">' : '',
            jsonld: buildJsonLd(l, canonical, og.url),
            og_image: og.url,
            og_image_width: String(og.width),
            og_image_height: String(og.height),
            og_image_type: og.type,
            cover_src: l.cover ? imgUrl(l, l.cover) : '/images/og-default.jpg',
            cover_filename: l.cover || '',
            status_ribbon: isInvest ? '' : reservedRibbon,
            cover_watermark_class: l.cover_is_visualization ? ' has-watermark' : '',
            cover_watermark_overlay: l.cover_is_visualization
                ? '    <span class="listing-watermark listing-watermark-hero" aria-hidden="true" data-i18n="listing.detail.visualization_badge">Vizualizace po rekonstrukci</span>'
                : '',
            breadcrumbs: renderBreadcrumbs(l),
            crosslink: renderCrosslink(l, dupSlugs),
            cta_button: renderCtaButton(l),
            description_html: renderDescription(l.description, `${kp}.desc`),
            info_panel: isInvest ? renderInvestorInfoPanel(l) : renderInfoPanel(l),
            spec_cards: renderSpecCards(l.specs),
            gallery_items: renderGallery(l, isInvest ? reservedRibbon : ''),
            // Investicni-only sections
            highlights_section:        isInvest ? renderHighlights(l.highlights, `${kp}.hl`) : '',
            investment_case_section:   isInvest ? renderInvestmentCase(l.investment_case) : '',
            investment_intent_section: isInvest ? renderInvestmentIntent(l.investment_intent, `${kp}.intent`) : '',
            state_section:             isInvest ? renderStateDescription(l.state_description, `${kp}.state`) : '',
            // Sticky CTA for mobile (investicni only)
            sticky_cta: isInvest
                ? `        <div class="listing-detail-cta-sticky">
            <div class="listing-detail-cta-sticky-price">${escapeHtml(shortenPriceForSticky(l.price))}</div>
            ${renderCtaButton(l)}
        </div>`
                : '',
            // Pre-built convenience strings for hero meta line (nabidka templates only)
            hero_meta_disposition: l.disposition ? `<span>✦ ${escapeHtml(l.disposition)} <span data-i18n="listing.detail.meta.disposition">dispozice</span></span>` : '',
            hero_meta_area:        l.area ? `<span>◊ ${escapeHtml(l.area)} m² <span data-i18n="listing.detail.meta.area">užitné plochy</span></span>` : '',
            hero_meta_floor:       l.floor ? `<span>⛶ ${escapeHtml(l.floor)}</span>` : (l.building_type ? `<span>⛶ ${escapeHtml(l.building_type)}</span>` : ''),
            type_index_path: isInvest ? '/investors' : `/nabidka/${l.type}`,
        });

        const out = path.join(dir, 'index.html');
        fs.writeFileSync(out, html);
        written.push(out);
        console.log(`  → ${cfg.outputBase}/${l.slug}/index.html  (${l.gallery.length} photo${l.gallery.length === 1 ? '' : 's'})`);
    }

    // Available (nova/aktivni) counts per type — the "X aktivních nabídek" labels on /nabidka.
    const availableOf = (ls) => ls.filter(l => AVAILABLE.has(l.status));
    const counts = {
        pronajem: availableOf(listings.filter(l => l.type === 'pronajem')).length,
        prodej:   availableOf(listings.filter(l => l.type === 'prodej')).length,
    };

    // Index pages (unified + per-type)
    const NABIDKA_TYPES = new Set(['pronajem', 'prodej']);
    for (const page of INDEX_PAGES) {
        // For nabidka root (filter:null) → only pronajem + prodej, not investicni
        const filtered = page.filter
            ? listings.filter(l => l.type === page.filter)
            : listings.filter(l => NABIDKA_TYPES.has(l.type));
        const avail = availableOf(filtered);
        const isNabidkaRoot = page.outputBase === 'nabidka' && page.filter === null;
        const isInvestorLanding = page.template === 'investors-landing.html';

        const cardsHtml = filtered.map(l => renderCard(l, cardTpl)).join('\n');

        const outDir = path.join(ROOT, page.outputBase);
        fs.mkdirSync(outDir, { recursive: true });

        // Placeholder for empty investor landing (uses .coming-soon block)
        const investorEmpty = isInvestorLanding && !filtered.length
            ? `        <section class="coming-soon">
            <div class="coming-soon-inner">
                <span class="coming-soon-icon" aria-hidden="true">⌂</span>
                <h2 data-i18n="investors.placeholder.title">Brzy zde najdete aktuální nabídky</h2>
                <p data-i18n="investors.placeholder.text">Pracuji na první sérii investičních příležitostí. Pokud máte zájem o spolupráci nebo chcete být první, kdo se dozví o nových projektech, ozvěte se.</p>
                <a href="/contact" class="btn btn-primary" data-i18n="investors.placeholder.cta" style="padding: 14px 28px; font-size: 14.5px; font-weight: 600;">Domluvit schůzku</a>
            </div>
        </section>`
            : '';

        const replacements = {
            canonical: `${SITE_URL}/${page.outputBase}`,
            page_title: escapeHtml(page.title),
            meta_description: escapeHtml(page.describe(avail)),
            cards: cardsHtml || '            <!-- žádné nabídky v této kategorii -->',
            eyebrow: page.eyebrow,
            eyebrow_key: page.eyebrow_key,
            h1: page.h1,
            h1_key: page.h1_key,
            category_cards: isNabidkaRoot ? renderCategoryCards(counts) : '',
            filter_nav: !isInvestorLanding ? renderFilterNav(page.tab, isNabidkaRoot) : '',
            counter: avail.length
                ? `<span class="listings-counter" data-i18n-key="listing.investicni.counter" data-i18n-count="${avail.length}">${pluralizeInvestorOffers(avail.length)}</span>`
                : '',
            grid_or_placeholder: investorEmpty,
            empty_notice: !isInvestorLanding && !filtered.length
                ? `<div class="listings-empty" style="text-align:center;color:var(--text-muted);padding:60px 0;">
            <p data-i18n="listings.empty.text">Aktuálně zde nemáme žádnou nabídku. Mrkněte na další kategorie nebo nás kontaktujte.</p>
            <a href="/contact" class="btn btn-primary" data-i18n="nav.contact">Kontakt</a>
        </div>`
                : '',
        };

        const out = path.join(outDir, 'index.html');
        fs.writeFileSync(out, renderTemplate(tpl(page.template), replacements));
        written.push(out);
        console.log(`  → ${page.outputBase}/index.html  (${filtered.length} card${filtered.length === 1 ? '' : 's'})`);
    }

    // Homepage featured investment cards
    if (updateHomepage(listings, cardTpl)) written.push(HOMEPAGE_PATH);

    // Sitemap — no lastmod/changefreq/priority (Google ignores the latter two;
    // a build date on every URL would be a false "changed" signal).
    const urls = [
        ...STATIC_ROUTES,
        ...INDEX_PAGES
            .filter(p => p.outputBase !== 'nabidka' && p.outputBase !== 'investors')
            .map(p => '/' + p.outputBase),
        ...listings.filter(l => !CLOSED.has(l.status)).map(listingUrl),
    ];
    const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        urls.map(u => `  <url>\n    <loc>${SITE_URL}${u}</loc>\n  </url>`).join('\n') +
        '\n</urlset>\n';
    fs.writeFileSync(SITEMAP_PATH, sitemap);
    console.log(`  → sitemap.xml (${urls.length} URLs)`);

    checkTranslations(written);
    buildDist();

    console.log('✓ Build complete');
}

if (require.main === module) build();

module.exports = { loadListings, updateHomepage, readTemplate, parseImageSize, priceNumber, stripExif };
