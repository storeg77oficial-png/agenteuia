jest.mock('../db', () => ({ query: jest.fn() }));

const { query } = require('../db');
const { invalidateKnowledge, loadKnowledge, parseQuery, searchCatalog, relaxSearch } = require('./catalog');

function product(id, title, brand, category, size, subcategory = '', tags = []) {
  return {
    shopify_product_id: id,
    title,
    brand,
    category,
    subcategory,
    description: '',
    tags: JSON.stringify(tags),
    sizes: JSON.stringify([size]),
    colors: '[]',
    images: '[]',
    stock_quantity: 5,
    in_stock: true,
    price: 120000,
    compare_at_price: null
  };
}

describe('catalog sales filters', () => {
  beforeEach(() => {
    invalidateKnowledge();
    query.mockResolvedValue({ rows: [
      product(1, 'CAMISETA NIKE PREMIUM', 'Nike', 'camisetas', 'S', 'HOMBRE'),
      product(2, 'CAMISETA NIKE TURCA', 'Nike', 'camisetas', 'S', 'MUJER'),
      product(3, 'CAMISETA ADIDAS PREMIUM', 'Adidas', 'camisetas', 'M', 'HOMBRE'),
      product(4, 'GORRA GUCCI TURCA', 'Gucci', 'gorras', 'Unitalla'),
      product(5, 'TENIS NIKE AIR MAX TL 2.5 ORIGINAL-', 'Nike', 'zapatos', '9', '', ['TENIS ORIGINALES']),
      product(6, 'TENIS NIKE 1.1-', 'Nike', 'zapatos', '8.5 - 9', '', ['TENIS 1.1'])
    ] });
  });

  test('parses category, brand, size, gender, quality and an all-brands preference', async () => {
    const knowledge = await loadKnowledge('tenant-1');
    const selected = parseQuery(knowledge, 'Camisetas Nike talla S para hombre premium');
    const allBrands = parseQuery(knowledge, 'Gorras turcas de todas las marcas');

    expect(selected).toMatchObject({
      categories: ['camisetas'],
      brands: ['nike'],
      sizes: ['S'],
      genders: ['hombre'],
      qualities: ['premium']
    });
    expect(allBrands).toMatchObject({ categories: ['gorras'], brands: [], qualities: ['turca'], allBrands: true });
  });

  test('understands a size sent as a standalone reply', async () => {
    const knowledge = await loadKnowledge('tenant-1');

    expect(parseQuery(knowledge, 'M').sizes).toEqual(['M']);
  });

  test('keeps quality, gender and size as strict filters', async () => {
    const result = await searchCatalog('tenant-1', {
      brands: ['nike'], categories: ['camisetas'], sizes: ['S'], colors: [], terms: [],
      qualities: ['premium'], genders: ['hombre'], min: null, max: null
    });

    expect(result.matches.map(match => match.id)).toEqual([1]);
    expect(result.relaxed).toEqual([]);
  });

  test('matches a requested shoe size inside a combined Shopify size option', async () => {
    const knowledge = await loadKnowledge('tenant-1');
    const parsed = parseQuery(knowledge, 'Busco tenis Nike en talla 9');
    const result = await searchCatalog('tenant-1', parsed);

    expect(parsed).toMatchObject({ brands: ['nike'], categories: ['zapatos'], sizes: ['9'] });
    expect(result.matches.map(match => match.id).sort()).toEqual([5, 6]);
  });

  test('keeps Shopify-purchasable variants even when tracked quantity is zero', async () => {
    const purchasable = product(7, 'TENIS NIKE 1.1-', 'Nike', 'zapatos', '8.5 - 9');
    purchasable.stock_quantity = 0;
    query.mockResolvedValue({ rows: [purchasable] });
    invalidateKnowledge();

    const result = await searchCatalog('tenant-1', {
      brands: ['nike'], categories: ['zapatos'], sizes: ['9'], colors: [], terms: [],
      qualities: [], genders: [], min: null, max: null
    });

    expect(result.matches.map(match => match.id)).toEqual([7]);
  });

  test('understands "las dos" as any quality and never as a search word', async () => {
    const knowledge = await loadKnowledge('tenant-1');
    const reply = parseQuery(knowledge, 'LAS DOS');

    expect(reply).toMatchObject({ anyQuality: true, qualities: [], terms: [], hasSignal: true });
    expect(parseQuery(knowledge, 'me da igual').anyQuality).toBe(true);
    expect(parseQuery(knowledge, 'premium las dos').anyQuality).toBe(false);
  });

  test('relaxSearch finds the closest real alternative and reports what it dropped', async () => {
    const base = {
      brands: ['nike'], categories: ['camisetas'], sizes: ['S'], colors: [], terms: [],
      qualities: ['original'], genders: ['hombre'], min: null, max: null
    };

    const byQuality = await relaxSearch('tenant-1', base);
    expect(byQuality.relaxed).toEqual(['calidad']);
    expect(byQuality.matches.map(match => match.id)).toEqual([1]);
    expect(byQuality.effective.qualities).toEqual([]);

    const junkWord = await relaxSearch('tenant-1', { ...base, qualities: ['premium'], terms: ['dos'] });
    expect(junkWord.relaxed).toEqual(['palabras extra']);
    expect(junkWord.matches.map(match => match.id)).toEqual([1]);
  });

  test('relaxSearch never swaps the brand or the garment', async () => {
    const result = await relaxSearch('tenant-1', {
      brands: ['gucci'], categories: ['camisetas'], sizes: [], colors: [], terms: [],
      qualities: [], genders: [], min: null, max: null
    });

    expect(result).toBeNull();
  });
});