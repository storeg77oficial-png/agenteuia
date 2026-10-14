jest.mock('./catalog', () => ({
  loadKnowledge: jest.fn(),
  parseQuery: jest.fn(),
  searchCatalog: jest.fn(),
  buildStoreSummary: jest.fn(),
  getAvailableQualities: jest.fn(),
  norm: value => String(value || '').toLowerCase()
}));
jest.mock('../shopify/sync', () => ({ refreshProductsLive: jest.fn() }));
jest.mock('./training', () => ({ getTrainingData: jest.fn() }));
jest.mock('./llm', () => ({ isEnabled: jest.fn(() => false), chat: jest.fn() }));

const { loadKnowledge, parseQuery, searchCatalog, getAvailableQualities } = require('./catalog');
const { refreshProductsLive } = require('../shopify/sync');
const { handleSellerTurn } = require('./seller');

const knowledge = { brands: new Map([['nike', { name: 'Nike' }]]) };
const customer = { name: 'Ana' };
const session = { state: 'browsing', context: {} };
const tenant = { id: 'tenant-1', business_name: 'STORE SG' };

function filters(overrides = {}) {
  return {
    brands: [], categories: ['camisetas'], sizes: ['S'], colors: [], qualities: ['premium'],
    genders: [], terms: [], allBrands: false, min: null, max: null, hasSignal: true, strongSignal: true,
    ...overrides
  };
}

function matches() {
  return [{
    id: 1, title: 'Camiseta Nike Premium', brand: 'Nike', category: 'camisetas', price: 120000,
    compareAt: null, sizes: ['S'], colors: [], image: null, handle: 'camiseta-nike-premium'
  }];
}

describe('sales assistant catalog replies', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadKnowledge.mockResolvedValue(knowledge);
    refreshProductsLive.mockResolvedValue(false);
    searchCatalog.mockResolvedValue({ matches: matches(), total: 17, relaxed: [], knowledge });
    getAvailableQualities.mockReturnValue([]);
  });

  test('asks for the missing size and preserves the current filters', async () => {
    parseQuery.mockReturnValue(filters({ sizes: [], qualities: [] }));

    const result = await handleSellerTurn(tenant, customer, session, 'Busco camisetas Nike');

    expect(result.text).toBe('¿Qué talla buscas?');
    expect(result.context.lastFilters.categories).toEqual(['camisetas']);
    expect(searchCatalog).not.toHaveBeenCalled();
  });

  test('sends the whole available catalog without applying a brand filter for all brands', async () => {
    parseQuery.mockReturnValue(filters({
      brands: [], categories: ['gorras'], sizes: [], qualities: ['turca'], allBrands: true
    }));

    const result = await handleSellerTurn(tenant, customer, session, 'Gorras turcas de todas las marcas');
    const catalogUrl = new URL(result.catalogUrl);

    expect(catalogUrl.pathname).toBe('/search');
    expect(catalogUrl.searchParams.get('q')).toBe('gorras turca');
    expect(catalogUrl.searchParams.get('filter.v.availability')).toBe('1');
    expect(catalogUrl.searchParams.has('filter.p.vendor')).toBe(false);
    expect(result.text).toContain(result.catalogUrl);
    expect(result.text).not.toContain('/products/');
    expect(result.images).toEqual([]);
  });

  test('does not claim a valid filtered link when the customer specifies gender', async () => {
    parseQuery.mockReturnValue(filters({ genders: ['hombre'] }));

    const result = await handleSellerTurn(tenant, customer, session, 'Camisetas para hombre');

    expect(result.catalogUrl).toBeNull();
    expect(result.text).toContain('no puedo generar un enlace');
  });
});