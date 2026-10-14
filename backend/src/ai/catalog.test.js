jest.mock('../db', () => ({ query: jest.fn() }));

const { query } = require('../db');
const { invalidateKnowledge, loadKnowledge, parseQuery, searchCatalog } = require('./catalog');

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
      product(4, 'GORRA GUCCI TURCA', 'Gucci', 'gorras', 'Unitalla')
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
});