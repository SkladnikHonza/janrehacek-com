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

const TYPES = ['pronajem', 'prodej'];   // recognized listing categories
const IMG_EXT = /\.(jpe?g|png|webp)$/i;
const COVER_NAME = /^01-uvodni\.(jpe?g|png|webp)$/i;

const STATIC_ROUTES = [
    { loc: '/',           priority: '1.0', changefreq: 'monthly' },
    { loc: '/about',      priority: '0.8', changefreq: 'monthly' },
    { loc: '/services',   priority: '0.9', changefreq: 'monthly' },
    { loc: '/investors',  priority: '0.9', changefreq: 'monthly' },
    { loc: '/references', priority: '0.7', changefreq: 'monthly' },
    { loc: '/nabidka',    priority: '0.9', changefreq: 'weekly' },
    { loc: '/blog',       priority: '0.6', changefreq: 'weekly' },
    { loc: '/contact',    priority: '0.9', changefreq: 'monthly' },
];

// Index pages to generate (each filters listings by type or shows all).
// `tab` matches one of the filter-nav tabs ('vse' | 'pronajem' | 'prodej') for active highlight.
// `eyebrow_key` / `h1_key` are i18n keys; the CZ string in `eyebrow` / `h1` is the build-time default.
const INDEX_PAGES = [
    { subdir: '',          depth: 1, filter: null,       tab: 'vse',      eyebrow_key: 'listings.eyebrow.all',  h1_key: 'listings.h1.all',  eyebrow: 'Nabídka nemovitostí',  h1: 'Aktuální nabídka <em>nemovitostí.</em>' },
    { subdir: 'pronajem/', depth: 2, filter: 'pronajem', tab: 'pronajem', eyebrow_key: 'listings.eyebrow.rent', h1_key: 'listings.h1.rent', eyebrow: 'Pronájem nemovitostí', h1: 'Aktuální <em>pronájmy.</em>' },
    { subdir: 'prodej/',   depth: 2, filter: 'prodej',   tab: 'prodej',   eyebrow_key: 'listings.eyebrow.sale', h1_key: 'listings.h1.sale', eyebrow: 'Prodej nemovitostí',   h1: 'Aktuální nabídka <em>k prodeji.</em>' },
];

// Type label shown on card badge (CZ default; i18n keys: listings.type.{rent,sale})
const TYPE_LABEL = { pronajem: 'PRONÁJEM', prodej: 'PRODEJ' };
const TYPE_I18N  = { pronajem: 'listings.type.rent', prodej: 'listings.type.sale' };

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
    'Popis':                'description',
    'Vybavení a stav':      'specs',
    'Specifikace':          'specs',
    'Podmínky pronájmu':    'rental_terms',  // currently unused (data lives in sidebar)
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

function renderDescription(text) {
    if (!text) return '';
    return text.split(/\n\s*\n/)
        .map(p => p.trim()).filter(Boolean)
        .map(p => '                <p>' + escapeHtml(p) + '</p>')
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
 */
function renderGallery(slug, type, images, title) {
    if (!images.length) return '            <!-- No gallery photos -->';
    const titleEsc = escapeHtml(title);
    const visible = images.slice(0, 5);
    const remaining = Math.max(0, images.length - visible.length);

    // Lightbox payload — every image with a readable alt
    const galleryData = images.map((file, i) => ({
        src: `../../../images/listings/${type}/${slug}/${file}`,
        alt: i === 0 ? title : `${title} — foto ${i + 1}`,
    }));
    const dataAttr = escapeHtml(JSON.stringify(galleryData));

    const tiles = visible.map((file, i) => {
        const src  = `../../../images/listings/${type}/${slug}/${file}`;
        const alt  = i === 0 ? titleEsc : `${titleEsc} — foto ${i + 1}`;
        const hero = i === 0 ? ' is-hero' : '';
        const showOverlay = (i === visible.length - 1) && remaining > 0;
        const loading = i === 0 ? 'eager' : 'lazy';
        return `            <button type="button" class="listing-gallery-item${hero}" data-gallery-open data-index="${i}" aria-label="Otevřít fotku ${i + 1} z ${images.length}">
                <img src="${src}" alt="${alt}" loading="${loading}">${showOverlay ? `
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
        location_short: data.location_short || '',
        location_long: data.location_long || data.location_short || '',
        disposition: data.disposition || '',
        area: data.area != null ? data.area : '',
        floor: data.floor || '',
        building_type: data.building_type || '',
        ownership: data.ownership || '',
        condition: data.condition || '',
        short_description: data.short_description || '',
        info_extra: data.info_extra || null,
        description: sections.description || '',
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

    const cardTpl   = readTemplate('listing-card.html');
    const indexTpl  = readTemplate('listing-index.html');
    const detailTpl = readTemplate('listing-detail.html');

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // Detail pages
    for (const l of listings) {
        const dir = path.join(OUTPUT_DIR, l.type, l.slug);
        fs.mkdirSync(dir, { recursive: true });
        const coverSrc = `../../../images/listings/${l.type}/${l.slug}/${l.cover}`;
        const html = renderTemplate(detailTpl, {
            base: '../../../',
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
            description_html: renderDescription(l.description),
            info_panel: renderInfoPanel(l),
            spec_cards: renderSpecCards(l.specs),
            gallery_items: renderGallery(l.slug, l.type, l.gallery, l.title),
            // Pre-built convenience strings for hero meta line
            hero_meta_disposition: l.disposition ? `<span>✦ ${escapeHtml(l.disposition)} dispozice</span>` : '',
            hero_meta_area:        l.area ? `<span>◊ ${escapeHtml(l.area)} m² užitné plochy</span>` : '',
            hero_meta_floor:       l.floor ? `<span>⛶ ${escapeHtml(l.floor)}</span>` : (l.building_type ? `<span>⛶ ${escapeHtml(l.building_type)}</span>` : ''),
            // Back link → filtered type index (absolute so it works with cleanUrls trailingSlash:false)
            type_index_path: `/nabidka/${l.type}/`,
        });
        fs.writeFileSync(path.join(dir, 'index.html'), html);
        console.log(`  → nabidka/${l.type}/${l.slug}/index.html  (${l.gallery.length} photo${l.gallery.length === 1 ? '' : 's'})`);
    }

    // Counts per type — fed into the big category-choice cards on the root page.
    const counts = {
        pronajem: listings.filter(l => l.type === 'pronajem').length,
        prodej:   listings.filter(l => l.type === 'prodej').length,
    };

    // Index pages (unified + per-type)
    for (const page of INDEX_PAGES) {
        const filtered = page.filter ? listings.filter(l => l.type === page.filter) : listings;
        const isRoot = page.filter === null;
        const base = '../'.repeat(page.depth);
        // Card href is always absolute → works with cleanUrls regardless of trailing slash
        const cardsHtml = filtered.map(l => {
            const href = `/nabidka/${l.type}/${l.slug}/`;
            const coverSrc = `${base}images/listings/${l.type}/${l.slug}/${l.cover}`;
            return renderTemplate(cardTpl, {
                href,
                title: escapeHtml(l.title),
                price: escapeHtml(l.price),
                location_short: escapeHtml(l.location_short),
                short_description: escapeHtml(l.short_description),
                cover_src: coverSrc,
                cover_alt: escapeHtml(l.title),
                badge: renderCardBadge(l),
                meta_line: renderCardMeta(l),
            });
        }).join('\n');

        const outDir = path.join(OUTPUT_DIR, page.subdir);
        fs.mkdirSync(outDir, { recursive: true });
        const html = renderTemplate(indexTpl, {
            base,
            cards: cardsHtml || '            <!-- žádné nabídky v této kategorii -->',
            eyebrow: page.eyebrow,
            eyebrow_key: page.eyebrow_key,
            h1: page.h1,
            h1_key: page.h1_key,
            category_cards: isRoot ? renderCategoryCards(counts) : '',
            filter_nav: renderFilterNav(page.tab, isRoot),
            empty_notice: filtered.length
                ? ''
                : '<p class="listings-empty" data-i18n-html="listings.empty.text" style="text-align:center;color:var(--text-muted);padding:60px 0;">Aktuálně zde nemáme žádnou nabídku. Mrkněte na další kategorie nebo nás <a href="' + base + 'contact.html" style="color:var(--accent-dark);font-weight:600;">kontaktujte</a>.</p>',
        });
        fs.writeFileSync(path.join(outDir, 'index.html'), html);
        console.log(`  → nabidka/${page.subdir}index.html  (${filtered.length} card${filtered.length === 1 ? '' : 's'})`);
    }

    // Sitemap
    const today = new Date().toISOString().split('T')[0];
    const urls = [
        ...STATIC_ROUTES,
        ...INDEX_PAGES.filter(p => p.subdir).map(p => ({
            loc: '/nabidka/' + p.subdir.replace(/\/$/, ''),
            priority: '0.8',
            changefreq: 'weekly',
        })),
        ...listings.map(l => ({
            loc: `/nabidka/${l.type}/${l.slug}`,
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
