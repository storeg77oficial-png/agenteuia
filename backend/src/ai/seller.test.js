jest.mock('./catalog', () => ({
  loadKnowledge: jest.fn(),
  parseQuery: jest.fn(),
  searchCatalog: jest.fn(),
  relaxSearch: jest.fn(),
  buildStoreSummary: jest.fn(),
  getAvailableQualities: jest.fn(),
  sizeMatches: (requested, available) => String(available || '').split(/\s*(?:-|–|—|\/)\s*/).includes(String(requested)),
  norm: value => String(value || '').toLowerCase()
}));
jest.mock('../shopify/sync', () => ({ refreshProductsLive: jest.fn() }));
jest.mock('./training', () => ({ getTrainingData: jest.fn(), listInstructions: jest.fn() }));
jest.mock('./learning', () => ({
  getLearnedVocab: jest.fn(),
  applyLearnedVocab: jest.fn(message => message),
  getUsualSize: jest.fn(),
  describeCustomer: jest.fn(),
  getInsightsPrompt: jest.fn(),
  observeTurn: jest.fn()
}));
jest.mock('./llm', () => ({ isEnabled: jest.fn(() => false), chat: jest.fn() }));

const { loadKnowledge, parseQuery, searchCatalog, relaxSearch, buildStoreSummary, getAvailableQualities } = require('./catalog');
const { getTrainingData, listInstructions } = require('./training');
const learning = require('./learning');
const llm = require('./llm');
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
    relaxSearch.mockResolvedValue(null);
    learning.getLearnedVocab.mockResolvedValue(new Map());
    learning.applyLearnedVocab.mockImplementation(message => message);
    learning.getUsualSize.mockResolvedValue(null);
    learning.describeCustomer.mockResolvedValue(null);
    learning.getInsightsPrompt.mockResolvedValue(null);
    listInstructions.mockResolvedValue([]);
    llm.isEnabled.mockReturnValue(false);
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

  test('includes exact and combined Shopify size labels in the catalog link', async () => {
    parseQuery.mockReturnValue(filters({ brands: ['nike'], categories: ['zapatos'], sizes: ['9'], qualities: ['original'] }));
    const shoeMatches = [
      { ...matches()[0], brand: 'Nike', category: 'zapatos', variants: [{ size: '9', inStock: true }] },
      { ...matches()[0], id: 2, title: 'Tenis Nike 1.1', brand: 'Nike', category: 'zapatos', variants: [{ size: '8.5 - 9', inStock: true }] }
    ];
    searchCatalog.mockResolvedValue({ matches: shoeMatches, total: 2, relaxed: [], knowledge });

    const result = await handleSellerTurn(tenant, customer, session, 'Busco tenis Nike talla 9');
    const catalogUrl = new URL(result.catalogUrl);

    expect(catalogUrl.searchParams.getAll('filter.v.option.talla')).toEqual(['9', '8.5 - 9']);
  });

  test('answers through the LLM with learned context without breaking the reply', async () => {
    llm.isEnabled.mockReturnValue(true);
    llm.chat.mockResolvedValue('Claro, mira estas opciones');
    getTrainingData.mockResolvedValue([]);
    listInstructions.mockResolvedValue([
      { instruction: 'No inventes promociones.', active: true },
      { instruction: 'Regla desactivada.', active: false }
    ]);
    buildStoreSummary.mockReturnValue('resumen');
    learning.describeCustomer.mockResolvedValue('tallas habituales: camisetas talla S');
    learning.getInsightsPrompt.mockResolvedValue('APRENDIZAJE DE LA ÚLTIMA SEMANA');
    parseQuery.mockReturnValue(filters());

    const result = await handleSellerTurn(tenant, customer, session, 'Busco camisetas Nike');
    const system = llm.chat.mock.calls[0][0][0].content;

    expect(result.text).toContain('Claro, mira estas opciones');
    expect(result.text).toContain(result.catalogUrl);
    expect(system).toContain('MEMORIA DEL CLIENTE');
    expect(system).toContain('APRENDIZAJE DE LA ÚLTIMA SEMANA');
    expect(system).toContain('No inventes promociones.');
    expect(system).not.toContain('Regla desactivada.');
  });

  test('uses the size the customer usually asks for and says so', async () => {
    learning.getUsualSize.mockResolvedValue('M');
    parseQuery.mockReturnValue(filters({ sizes: [], qualities: [] }));

    const result = await handleSellerTurn(tenant, { id: 'c1' }, session, 'Busco camisetas Nike');

    expect(searchCatalog.mock.calls[0][1].sizes).toEqual(['M']);
    expect(result.text).toContain('la talla M, la que sueles pedir');
    expect(result.context.lastFilters.sizes).toEqual(['M']);
  });

  test('understands learned vocabulary and reports what it observed', async () => {
    const vocab = new Map([['chompa', { word: 'chaqueta' }]]);
    learning.getLearnedVocab.mockResolvedValue(vocab);
    learning.applyLearnedVocab.mockReturnValue('Busco chaqueta talla S');
    parseQuery.mockReturnValue(filters({ categories: ['chaquetas'] }));

    await handleSellerTurn(tenant, { id: 'c1' }, session, 'Busco chompa talla S');

    expect(parseQuery.mock.calls[0][1]).toBe('Busco chaqueta talla S');
    expect(learning.observeTurn).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', customerId: 'c1', exact: true
    }));
  });

  test('does not ask for the quality again after "las dos"', async () => {
    getAvailableQualities.mockReturnValue(['original', 'premium']);
    parseQuery.mockReturnValue(filters({ qualities: [], anyQuality: true }));

    const result = await handleSellerTurn(tenant, customer, session, 'LAS DOS');

    expect(result.text).not.toContain('¿Qué calidad buscas');
    expect(searchCatalog).toHaveBeenCalled();
    expect(result.context.lastFilters.anyQuality).toBe(true);
  });

  test('offers the closest real alternative and says what was relaxed', async () => {
    parseQuery.mockReturnValue(filters({ brands: ['nike'], qualities: ['original'] }));
    searchCatalog.mockResolvedValue({ matches: [], total: 0, relaxed: [], knowledge });
    relaxSearch.mockResolvedValue({
      matches: matches(), total: 1, relaxed: ['calidad'], knowledge, effective: filters({ brands: ['nike'], qualities: [] })
    });

    const result = await handleSellerTurn(tenant, customer, session, 'Camiseta Nike M original');

    expect(result.text).toContain('No tengo');
    expect(result.text).toContain('sin filtrar por calidad');
    expect(new URL(result.catalogUrl).searchParams.get('q')).not.toContain('original');
    expect(result.context.lastFilters.qualities).toEqual([]);
    expect(learning.observeTurn).toHaveBeenCalledWith(expect.objectContaining({ exact: false }));
  });

  test('offers other brands when nothing exists and understands the "sí" that follows', async () => {
    parseQuery.mockReturnValue(filters({ brands: ['nike'] }));
    searchCatalog.mockResolvedValue({ matches: [], total: 0, relaxed: [], knowledge });

    const offer = await handleSellerTurn(tenant, customer, session, 'Camiseta Nike M');
    expect(offer.text).toContain('otras marcas');
    expect(offer.context.pendingOffer).toBe('allBrands');

    searchCatalog.mockResolvedValue({ matches: matches(), total: 17, relaxed: [], knowledge });
    parseQuery.mockReturnValue(filters({ categories: [], sizes: [], qualities: [], hasSignal: false, strongSignal: false }));
    const followUp = { context: { pendingOffer: 'allBrands', lastFilters: offer.context.lastFilters } };
    const answer = await handleSellerTurn(tenant, customer, followUp, 'Si por favor');

    expect(searchCatalog.mock.calls.pop()[1]).toMatchObject({ brands: [], allBrands: true });
    expect(answer.text).toContain('https://');
    expect(answer.context.pendingOffer).toBeNull();
  });

  test('"olvida eso" clears the previous search instead of searching for those words', async () => {
    const stale = { context: { lastFilters: filters({ brands: ['nike'], sizes: ['9'] }) } };

    const result = await handleSellerTurn(tenant, customer, stale, 'Olvida eso');

    expect(result.text).toContain('empezamos de nuevo');
    expect(result.context.lastFilters).toBeNull();
    expect(searchCatalog).not.toHaveBeenCalled();
  });

  test('"olvida eso" keeps whatever new request comes in the same message', async () => {
    parseQuery.mockReturnValue(filters());

    const result = await handleSellerTurn(tenant, customer, session, 'Olvida eso, busco camisetas Nike');

    expect(parseQuery.mock.calls.pop()[1]).toBe('busco camisetas nike');
    expect(searchCatalog).toHaveBeenCalled();
    expect(result.text).toContain('https://');
  });

  test('apologizes and restarts when the customer says the bot is lost, then hands over if it repeats', async () => {
    const first = await handleSellerTurn(tenant, customer, session, 'Estas alucinando');
    expect(first.text).toContain('Tienes razón');
    expect(first.transferToHuman).toBe(false);
    expect(first.context.lastFilters).toBeNull();
    expect(first.context.confusionCount).toBe(1);

    const second = await handleSellerTurn(tenant, customer, { context: first.context }, 'no entiendes nada');
    expect(second.transferToHuman).toBe(true);
    expect(searchCatalog).not.toHaveBeenCalled();
  });

  test('"todos los tenis nike" shows the whole catalog without asking or inheriting a size', async () => {
    learning.getUsualSize.mockResolvedValue('9');
    parseQuery.mockReturnValue(filters({
      brands: ['nike'], categories: ['zapatos'], sizes: [], qualities: [], wantsAll: true
    }));

    const result = await handleSellerTurn(tenant, customer, session, 'Muéstrame todos los tenis nike');

    expect(searchCatalog.mock.calls[0][1].sizes).toEqual([]);
    expect(new URL(result.catalogUrl).searchParams.has('filter.v.option.talla')).toBe(false);
  });

  test('a "no" to the offer moves on instead of repeating itself', async () => {
    parseQuery.mockReturnValue(filters({ categories: [], hasSignal: false, strongSignal: false }));
    const followUp = { context: { pendingOffer: 'allBrands', lastFilters: filters({ brands: ['nike'] }) } };

    const result = await handleSellerTurn(tenant, customer, followUp, 'No gracias');

    expect(result.text).toContain('¿Qué otra cosa te gustaría ver?');
    expect(result.context.pendingOffer).toBeNull();
    expect(searchCatalog).not.toHaveBeenCalled();
  });

  test('lists the products when no reliable link exists for the gender filter', async () => {
    parseQuery.mockReturnValue(filters({ genders: ['hombre'] }));

    const result = await handleSellerTurn(tenant, customer, session, 'Camisetas Nike hombre');

    expect(result.text).toContain('Camiseta Nike Premium - $120.000');
    expect(result.text).toContain('/products/camiseta-nike-premium');
  });
});