#!/usr/bin/env node
/**
 * build.js — file-based listings generator
 *
 * Reads every folder in images/listings/ (skipping ones starting with `_`)
 * as a property listing. Each folder must contain:
 *   - info.md       YAML frontmatter + Markdown body (Popis, Specifikace)
 *   - cover.jpg     hero / card cover photo
 *   - 01.jpg, ...   gallery photos (any count, sorted lexicographically)
 *
 * Generates:
 *   - nabidka/index.html             grid of listing cards
 *   - nabidka/{slug}/index.html      detail page per listing
 *   - sitemap.xml                    static routes + dynamic listing URLs
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

// Icon mapping for spec cards (add more as needed)
const SPEC_ICONS = {
    'Rok rekonstrukce':   '⌂',
    'Energetická třída':  '⚡',
    'Výtah':              '⇕',
    'Sklep':              '▦',
    'Balkon':             '◐',
    'Balkon / lodžie':    '◐',
    'Lodžie':             '◐',
    'Parkování':          '⌭',
    'Parking':            '⌭',
    'Garáž':              '⌭',
    'Orientace':          '☀',
    'Vybavení':           '✓',
    'Typ stavby':         '⌂',
    'Vlastnictví':        '◊',
    'Stav':               '✦',
};

// Status badge config + sort order (active listings on top)
const STATUS_BADGE = {
    nova:         { label: 'Nová nabídka' },
    aktivni:      { label: 'Aktivní' },
    rezervovano:  { label: 'Rezervováno' },
    prodano:      { label: 'Prodáno' },
};
const STATUS_ORDER = ['nova', 'aktivni', 'rezervovano', 'prodano'];

// ===== HELPERS =====
function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Minimal YAML frontmatter parser. Supports:
 *    key: "value"
 *    key: 42
 *    key:                  (nested map)
 *      subkey: "value"
 *  Returns { data, body }.
 */
function parseFrontmatter(src) {
    const m = src.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
    if (!m) throw new Error('Missing YAML frontmatter (--- ... ---)');
    const yamlBlock = m[1];
    const body = m[2];
    const data = {};
    let currentMap = null;

    for (const rawLine of yamlBlock.split(/\r?\n/)) {
        if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;

        // Nested item: at least 2 spaces of indent
        if (/^\s{2,}/.test(rawLine) && currentMap) {
            const nm = rawLine.trim().match(/^([^:]+):\s*(.*)$/);
            if (nm) {
                let v = nm[2].trim();
                if ((v.startsWith('"') && v.endsWith('"')) ||
                    (v.startsWith("'") && v.endsWith("'"))) {
                    v = v.slice(1, -1);
                }
                currentMap[nm[1].trim()] = v;
            }
            continue;
        }

        // Top-level key
        const tm = rawLine.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/);
        if (!tm) continue;
        const key = tm[1];
        let val = tm[2].trim();

        if (val === '') {
            // Start of nested map
            data[key] = {};
            currentMap = data[key];
            continue;
        }
        currentMap = null;

        // Strip surrounding quotes
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        } else if (/^-?\d+(\.\d+)?$/.test(val)) {
            // Bare numeric → Number
            val = Number(val);
        }
        data[key] = val;
    }
    return { data, body };
}

/** Split Markdown body into named sections by H2 (## heading). */
function parseMarkdownSections(body) {
    const out = {};
    if (!body) return out;
    const parts = body.split(/^##\s+/m);
    // First part (before any ##) is intro, usually empty
    for (let i = 1; i < parts.length; i++) {
        const chunk = parts[i];
        const [heading, ...rest] = chunk.split('\n');
        out[heading.trim()] = rest.join('\n').trim();
    }
    return out;
}

/** Convert Popis text → multiple <p> blocks (blank-line separated). */
function renderDescription(text) {
    if (!text) return '';
    return text.split(/\n\s*\n/)
        .map(p => p.trim())
        .filter(Boolean)
        .map(p => '                <p>' + escapeHtml(p) + '</p>')
        .join('\n');
}

/** Parse "- Label: Value" bullets into [{label, value}, ...]. */
function parseSpecs(text) {
    if (!text) return [];
    return text.split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('-'))
        .map(l => {
            const m = l.match(/^-\s*([^:]+):\s*(.*)$/);
            return m ? { label: m[1].trim(), value: m[2].trim() } : null;
        })
        .filter(Boolean);
}

function renderSpecCards(specs) {
    return specs.map(s => {
        const icon = SPEC_ICONS[s.label] || '⌂';
        return `            <div class="listing-spec-card">
                <div class="listing-spec-icon">${icon}</div>
                <div class="listing-spec-label">${escapeHtml(s.label)}</div>
                <div class="listing-spec-value">${escapeHtml(s.value)}</div>
            </div>`;
    }).join('\n');
}

function renderInfoTableRows(l) {
    const rows = [
        { label: 'Dispozice', value: l.disposition },
        { label: 'Plocha',    value: l.area + ' m²' },
        { label: 'Patro',     value: l.floor },
        { label: 'Lokalita',  value: l.location_long || l.location_short },
    ];
    if (l.info_extra && typeof l.info_extra === 'object') {
        for (const k of Object.keys(l.info_extra)) {
            rows.push({ label: k, value: l.info_extra[k] });
        }
    }
    return rows.map(r =>
        `                    <div class="listing-info-row">
                        <span class="listing-info-label">${escapeHtml(r.label)}</span>
                        <span class="listing-info-value">${escapeHtml(r.value)}</span>
                    </div>`
    ).join('\n');
}

function listGalleryPhotos(slug) {
    const dir = path.join(LISTINGS_DIR, slug);
    return fs.readdirSync(dir)
        .filter(f => /^\d+\.(jpg|jpeg|png|webp)$/i.test(f)) // 01.jpg, 02.jpg, ...
        .sort();
}

function renderGallery(slug, photos) {
    if (photos.length === 0) return '            <!-- No gallery photos -->';
    return photos.map((file, i) => {
        // First and last span 2 columns for visual variety
        const wide = (photos.length >= 3 && (i === 0 || i === photos.length - 1)) ? ' wide' : '';
        const src = `../../images/listings/${slug}/${file}`;
        return `            <a href="${src}" target="_blank" rel="noopener" class="listing-gallery-item${wide}">
                <img src="${src}" alt="${escapeHtml(file)}" loading="lazy">
            </a>`;
    }).join('\n');
}

function renderBadge(status) {
    const info = STATUS_BADGE[status];
    if (!info) return '';
    return `                    <div class="listing-card-badge">${escapeHtml(info.label)}</div>`;
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

function readListing(slug) {
    const infoPath = path.join(LISTINGS_DIR, slug, 'info.md');
    if (!fs.existsSync(infoPath)) {
        throw new Error(`Missing info.md in images/listings/${slug}/`);
    }
    const src = fs.readFileSync(infoPath, 'utf8');
    const { data, body } = parseFrontmatter(src);
    const sections = parseMarkdownSections(body);
    return {
        slug,
        title: data.title || slug,
        status: data.status || 'aktivni',
        price: data.price || 'Cena na vyžádání',
        location_short: data.location_short || '',
        location_long: data.location_long || data.location_short || '',
        disposition: data.disposition || '',
        area: data.area != null ? data.area : '',
        floor: data.floor || '',
        short_description: data.short_description || '',
        info_extra: data.info_extra || null,
        description: sections['Popis'] || '',
        specs: parseSpecs(sections['Specifikace'] || ''),
        gallery: listGalleryPhotos(slug),
    };
}

// ===== BUILD =====
function build() {
    if (!fs.existsSync(LISTINGS_DIR)) {
        console.error(`✗ Listings folder missing: ${LISTINGS_DIR}`);
        process.exit(1);
    }

    // Discover listing slugs (skip _template, hidden, files)
    const slugs = fs.readdirSync(LISTINGS_DIR)
        .filter(f => !f.startsWith('_') && !f.startsWith('.'))
        .filter(f => fs.statSync(path.join(LISTINGS_DIR, f)).isDirectory());

    if (slugs.length === 0) {
        console.warn(`⚠ No listing folders found in ${LISTINGS_DIR}`);
    }

    const listings = slugs.map(readListing)
        .sort((a, b) => {
            const ai = STATUS_ORDER.indexOf(a.status);
            const bi = STATUS_ORDER.indexOf(b.status);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });

    console.log(`Found ${listings.length} listing(s): ${listings.map(l => l.slug).join(', ')}`);

    // Load templates
    const cardTpl = readTemplate('listing-card.html');
    const indexTpl = readTemplate('listing-index.html');
    const detailTpl = readTemplate('listing-detail.html');

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // Render detail pages
    for (const l of listings) {
        const detailDir = path.join(OUTPUT_DIR, l.slug);
        fs.mkdirSync(detailDir, { recursive: true });
        const html = renderTemplate(detailTpl, {
            slug: l.slug,
            title: escapeHtml(l.title),
            price: escapeHtml(l.price),
            location_short: escapeHtml(l.location_short),
            location_long: escapeHtml(l.location_long),
            disposition: escapeHtml(l.disposition),
            area: escapeHtml(l.area + ' m²'),
            floor: escapeHtml(l.floor),
            short_description: escapeHtml(l.short_description),
            description_html: renderDescription(l.description),
            info_table_rows: renderInfoTableRows(l),
            spec_cards: renderSpecCards(l.specs),
            gallery_items: renderGallery(l.slug, l.gallery),
        });
        fs.writeFileSync(path.join(detailDir, 'index.html'), html);
        console.log(`  → nabidka/${l.slug}/index.html  (${l.gallery.length} gallery photo${l.gallery.length === 1 ? '' : 's'})`);
    }

    // Render listing index
    const cardsHtml = listings.map(l => renderTemplate(cardTpl, {
        slug: l.slug,
        title: escapeHtml(l.title),
        price: escapeHtml(l.price),
        location_short: escapeHtml(l.location_short),
        disposition: escapeHtml(l.disposition),
        area: escapeHtml(l.area + ' m²'),
        floor: escapeHtml(l.floor),
        short_description: escapeHtml(l.short_description),
        cover_src: `../images/listings/${l.slug}/cover.jpg`,
        cover_alt: escapeHtml(l.title),
        badge: renderBadge(l.status),
    })).join('\n');
    fs.writeFileSync(
        path.join(OUTPUT_DIR, 'index.html'),
        renderTemplate(indexTpl, { cards: cardsHtml })
    );
    console.log(`  → nabidka/index.html`);

    // Sitemap
    const today = new Date().toISOString().split('T')[0];
    const allUrls = [
        ...STATIC_ROUTES,
        ...listings.map(l => ({
            loc: `/nabidka/${l.slug}`,
            priority: '0.7',
            changefreq: 'monthly',
        })),
    ];
    const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">\n' +
        allUrls.map(u =>
            `  <url>
    <loc>${SITE_URL}${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
        ).join('\n') +
        '\n</urlset>\n';
    fs.writeFileSync(SITEMAP_PATH, sitemap);
    console.log(`  → sitemap.xml (${allUrls.length} URLs)`);

    console.log('✓ Build complete');
}

build();
