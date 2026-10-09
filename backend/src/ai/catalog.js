/**
 * Store knowledge: the whole catalog in memory (brands, categories, colors, sizes)
 * plus a query parser and ranked search with progressive relaxation.
 */
const { query } = require('../db');

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = null;

const BRAND_ALIASES = {
  ck: 'calvin klein', lv: 'louis vuitton', 'off white': 'off white', offwhite: 'off white',
  'michael kors': 'michael kors', mk: 'michael kors', 'palm angels': 'palm angels'
};

const {
  normalizeSlang, FILLER_WORDS, COLOR_ALIASES, CATEGORY_SYNONYMS, MULTI_CATEGORY_WORDS
} = require('./colombian');

const synonymRegexCache = new Map();

const STOPWORDS = new Set(('de la el los las un una unos unas que tienen tiene tienes tengan hay busco buscando buscar quiero ' +
  'necesito me mi para en con y o por favor hola buenas buenos dias tardes noches ver mostrar muestrame mostrarme ' +
  'talla tallas color colores precio precios cuanto cuesta cuestan vale valen disponible disponibles algo mas menos ' +
  'mil pesos cop hasta entre desde minimo maximo estan esta algun alguna referencia marca marcas tipo como ' +
  'quisiera quería queria podrias puedes pueden dame dime saber si no al del lo le se es son ya aun todavia ' +
  'barato barata baratos baratas economico economica nuevo nueva nuevos nuevas otra otro otros otras ' +
  'gracias ok vale claro comprar comprarlo comprarla compro pedir ordenar separar separame apartar llevar llevo ' +
  'cual cuales precio tienes disponibilidad ' + FILLER_WORDS.join(' ')).split(' '));

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function stem(word) {
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function colorStem(word) {
  return word.length > 3 ? word.replace(/[aos]+$/, '') : word;
}

// In Colombia "sudadera" is the lower garment (jogger); the upper one is "buzo". Shopify's product type mixes them.
function classify(title, category) {
  const t = norm(title);
  if (/(buzo|buso|hoodie|canguro)/.test(t)) return 'buzos';
  if (/\b(sudadera|jogger)s?\b/.test(t)) return 'sudaderas';
  if (/\b(leggins|leggings|licra|lycra)\b/.test(t)) return 'leggins';
  if (/\b(pantaloneta|short|bermuda)s?\b/.test(t)) return 'pantalonetas';
  return category;
}

function parseJson(value, fallback) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value) || fallback; } catch (e) { return fallback; }
}

async function loadKnowledge(tenantId, force = false) {
  if (!force && cache && cache.tenantId === tenantId && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache;
  }

  const rows = (await query('SELECT * FROM products WHERE tenant_id = $1', [tenantId])).rows;
  const byProduct = new Map();

  for (const row of rows) {
    let product = byProduct.get(row.shopify_product_id);
    if (!product) {
      const images = parseJson(row.images, []);
      product = {
        id: row.shopify_product_id,
        title: row.title,
        brand: row.brand && row.brand !== 'Sin marca' ? row.brand : null,
        category: classify(row.title, row.category),
        description: row.description || '',
        tags: parseJson(row.tags, []),
        image: images[0]?.url || null,
        handle: row.handle || null,
        compareAt: row.compare_at_price || null,
        variants: []
      };
      byProduct.set(row.shopify_product_id, product);
    }
    product.variants.push({
      size: parseJson(row.sizes, [])[0] || null,
      color: parseJson(row.colors, [])[0] || null,
      qty: row.stock_quantity || 0,
      inStock: !!row.in_stock && (row.stock_quantity || 0) > 0,
      price: row.price
    });
  }

  const products = [];
  const brands = new Map();
  const categories = new Map();
  const colorStems = new Map();

  for (const product of byProduct.values()) {
    const live = product.variants.filter(v => v.inStock);
    product.inStock = live.length > 0;
    product.price = Math.min(...(live.length ? live : product.variants).map(v => v.price));
    product.sizes = [...new Set(live.map(v => v.size).filter(Boolean))];
    product.colors = [...new Set(live.map(v => v.color).filter(Boolean))];
    product.haystack = norm([product.title, product.brand, product.category, product.tags.join(' '), product.description].join(' '));
    product.titleNorm = norm(`${product.title} ${product.brand || ''} ${product.category || ''}`);
    products.push(product);

    if (product.brand) {
      const key = norm(product.brand);
      const entry = brands.get(key) || { name: product.brand, count: 0 };
      entry.count++;
      brands.set(key, entry);
    }
    const cat = categories.get(product.category) || { name: product.category, count: 0, min: Infinity, max: 0 };
    cat.count++;
    cat.min = Math.min(cat.min, product.price);
    cat.max = Math.max(cat.max, product.price);
    categories.set(product.category, cat);

    for (const color of product.variants.map(v => v.color).filter(Boolean)) {
      colorStems.set(colorStem(norm(color).split(' ')[0]), color);
    }
  }

  cache = { tenantId, loadedAt: Date.now(), products, brands, categories, colorStems };
  return cache;
}

function invalidateKnowledge() {
  cache = null;
}

// Maps a (Colombian) color word to the stem used by the store's own color names
function findColorStem(word, knowledge) {
  if (word.length < 3) return null;
  const candidates = COLOR_ALIASES[word] || [colorStem(word)];
  for (const candidate of candidates) {
    for (const key of knowledge.colorStems.keys()) {
      if (key === candidate || (candidate.length >= 3 && key.startsWith(candidate))) return key;
    }
  }
  return null;
}

function parsePrice(msg) {
  const out = {};
  const num = '(\\d{1,3}(?:[.,]\\d{3})+|\\d+)\\s*(mil|k)?';
  const toNumber = (raw, unit) => {
    let n = parseFloat(String(raw).replace(/[.,](?=\d{3})/g, ''));
    if (unit) n *= 1000;
    return n >= 1000 ? n : null;
  };

  const between = msg.match(new RegExp(`entre\\s+${num}\\s+y\\s+${num}`));
  if (between) {
    out.min = toNumber(between[1], between[2]);
    out.max = toNumber(between[3], between[4]);
  }
  const max = msg.match(new RegExp(`(?:menos de|hasta|maximo|max|por debajo de|no mas de|presupuesto de)\\s+\\$?\\s*${num}`));
  if (max) out.max = toNumber(max[1], max[2]);
  const min = msg.match(new RegExp(`(?:mas de|desde|minimo|min|por encima de)\\s+\\$?\\s*${num}`));
  if (min) out.min = toNumber(min[1], min[2]);
  // "una camiseta de 200 lucas" / "por 150000": a budget
  if (!out.max && !out.min) {
    const budget = msg.match(/\b(?:de|por|en|a)\s+\$?\s*(\d{5,7})\b/);
    if (budget) out.max = Number(budget[1]);
  }
  return out;
}

/** Turn a free-text message into structured filters using what the store really sells. */
function parseQuery(knowledge, message) {
  let text = ` ${normalizeSlang(message)} `;
  const parsed = { brands: [], categories: [], sizes: [], colors: [], terms: [], min: null, max: null };

  const price = parsePrice(text.trim());
  parsed.min = price.min || null;
  parsed.max = price.max || null;
  text = text.replace(/\$?\s*\d{1,3}(?:[.,]\d{3})+|\b\d+\s*(?:mil|k)\b|\b\d{4,}\b/g, ' ');

  for (const [alias, brand] of Object.entries(BRAND_ALIASES)) {
    if (text.includes(` ${alias} `)) {
      parsed.brands.push(brand);
      text = text.replace(` ${alias} `, ' ');
    }
  }
  for (const key of knowledge.brands.keys()) {
    if (key.length > 1 && text.includes(` ${key} `)) {
      if (!parsed.brands.includes(key)) parsed.brands.push(key);
      text = text.replace(` ${key} `, ' ');
    }
  }

  const sizeMatch = text.match(/\b(?:talla|size|en talla|tla)\s+(xxs|xs|s|m|l|xl|xxl|2xl|3xl|4xl|\d{2}(?:\s?5)?)\b/);
  if (sizeMatch) {
    parsed.sizes.push(sizeMatch[1].replace(/\s/g, '.').toUpperCase());
    text = text.replace(sizeMatch[0], ' ');
  }
  for (const m of text.matchAll(/\b(xxs|xs|xl|xxl|2xl|3xl|4xl)\b/g)) {
    parsed.sizes.push(m[1].toUpperCase());
    text = text.replace(m[0], ' ');
  }
  // Colombian chat: "tienen en M?", "una L", "mi talla es S"
  const looseSize = text.match(/\b(?:en|una|la|un|mi talla es|talla es)\s+(xs|s|m|l)\b/);
  if (looseSize && !parsed.sizes.length) {
    parsed.sizes.push(looseSize[1].toUpperCase());
    text = text.replace(looseSize[0], ' ');
  }

  const words = text.split(' ').filter(Boolean);
  for (const word of words) {
    if (STOPWORDS.has(word)) continue;
    const colorKey = findColorStem(word, knowledge);
    if (colorKey) {
      if (!parsed.colors.includes(colorKey)) parsed.colors.push(colorKey);
      continue;
    }
    const s = stem(word);
    if (MULTI_CATEGORY_WORDS[word]) {
      for (const c of MULTI_CATEGORY_WORDS[word]) if (!parsed.categories.includes(c)) parsed.categories.push(c);
      continue;
    }
    const category = Object.entries(CATEGORY_SYNONYMS).find(([, syns]) => syns.includes(word) || syns.includes(s));
    if (category) {
      if (!parsed.categories.includes(category[0])) parsed.categories.push(category[0]);
      continue;
    }
    if (knowledge.categories.has(word) || knowledge.categories.has(s + 's')) {
      parsed.categories.push(knowledge.categories.has(word) ? word : s + 's');
      continue;
    }
    if (s.length > 2) parsed.terms.push(s);
  }

  parsed.hasSignal = !!(parsed.brands.length || parsed.categories.length || parsed.terms.length ||
    parsed.colors.length || parsed.sizes.length || parsed.max || parsed.min);
  parsed.strongSignal = !!(parsed.brands.length || parsed.categories.length);
  return parsed;
}

function matchesCategory(product, category) {
  if (product.category === category) return true;
  let regex = synonymRegexCache.get(category);
  if (!regex) {
    const syns = CATEGORY_SYNONYMS[category] || [category.replace(/s$/, '')];
    regex = new RegExp(`\\b(?:${syns.join('|')})s?\\b`);
    synonymRegexCache.set(category, regex);
  }
  return regex.test(product.titleNorm);
}

function applyFilters(products, parsed, skip) {
  return products.filter(p => {
    if (!p.inStock || !(p.price > 0)) return false;
    if (parsed.brands.length && !skip.has('brand') &&
        !parsed.brands.some(b => norm(p.brand) === b || p.titleNorm.includes(b))) return false;
    if (parsed.categories.length && !skip.has('category') &&
        !parsed.categories.some(c => matchesCategory(p, c))) return false;
    if (parsed.sizes.length && !skip.has('size') &&
        !p.variants.some(v => v.inStock && v.size && parsed.sizes.includes(v.size))) return false;
    if (parsed.colors.length && !skip.has('color') &&
        !p.variants.some(v => v.inStock && v.color && parsed.colors.includes(colorStem(norm(v.color).split(' ')[0])))) return false;
    if (parsed.max && !skip.has('price') && p.price > parsed.max) return false;
    if (parsed.min && !skip.has('price') && p.price < parsed.min) return false;
    return true;
  });
}

function score(product, parsed) {
  let s = 0;
  for (const term of parsed.terms) {
    // Colors usually live in the product title, not in variant options
    const candidates = COLOR_ALIASES[term] || [term];
    if (candidates.some(c => product.titleNorm.includes(c))) s += 3;
    else if (candidates.some(c => product.haystack.includes(c))) s += 1;
  }
  return s;
}

/**
 * Ranked search. If nothing matches, drops constraints one at a time
 * (size, color, price, category, brand) and reports which were relaxed.
 */
async function searchCatalog(tenantId, parsed, limit = 12) {
  const knowledge = await loadKnowledge(tenantId);
  const order = ['size', 'color', 'price', 'category', 'brand'];
  const skip = new Set();
  const relaxed = [];

  const run = () => {
    let list = applyFilters(knowledge.products, parsed, skip);
    if (parsed.terms.length) {
      const scored = list.map(p => ({ p, s: score(p, parsed) }));
      const hits = scored.filter(x => x.s > 0);
      if (!hits.length && parsed.terms.some(t => COLOR_ALIASES[t]) && !relaxed.includes('color')) relaxed.push('color');
      list = hits.length ? hits.sort((a, b) => b.s - a.s).map(x => x.p) : (parsed.strongSignal ? list : []);
    }
    return list;
  };

  let matches = run();
  for (const constraint of order) {
    if (matches.length) break;
    const used = { size: parsed.sizes.length, color: parsed.colors.length, price: parsed.min || parsed.max,
      category: parsed.categories.length, brand: parsed.brands.length }[constraint];
    if (!used) continue;
    skip.add(constraint);
    relaxed.push(constraint);
    matches = run();
  }

  // Cheapest-first among equally relevant results is more useful in a shop chat
  if (!parsed.terms.length) matches = [...matches].sort((a, b) => a.price - b.price);
  return { matches: matches.slice(0, limit), total: matches.length, relaxed: [...new Set(relaxed)], knowledge };
}

function buildStoreSummary(knowledge) {
  const inStock = knowledge.products.filter(p => p.inStock);
  const brands = [...knowledge.brands.values()].sort((a, b) => b.count - a.count)
    .map(b => `${b.name} (${b.count})`).join(', ');
  const cats = [...knowledge.categories.values()].sort((a, b) => b.count - a.count)
    .map(c => `${c.name}: ${c.count} modelos, $${Math.round(c.min).toLocaleString('es-CO')} a $${Math.round(c.max).toLocaleString('es-CO')}`).join('\n');
  return `Modelos disponibles hoy: ${inStock.length}\nMarcas: ${brands}\nCategorías:\n${cats}`;
}

module.exports = { loadKnowledge, invalidateKnowledge, parseQuery, searchCatalog, buildStoreSummary, norm };
