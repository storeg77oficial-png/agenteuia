jest.mock('../db', () => ({ query: jest.fn(), isLocal: true }));
jest.mock('axios', () => ({ get: jest.fn() }));

const { syncCatalog, isPurchasable } = require('./sync');

describe('Shopify catalog synchronization', () => {
  const shopifyEnv = ['SHOPIFY_ACCESS_TOKEN', 'SHOPIFY_STORE_URL'];
  const originalEnv = {};

  beforeAll(() => {
    for (const key of shopifyEnv) originalEnv[key] = process.env[key];
  });

  beforeEach(() => {
    for (const key of shopifyEnv) delete process.env[key];
  });

  afterAll(() => {
    for (const key of shopifyEnv) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  test('skips when Shopify credentials are missing instead of throwing', async () => {
    await expect(syncCatalog({ id: 'tenant-1' })).resolves.toEqual({ skipped: true });
  });

  test('respects Shopify availability and continue-selling policy', () => {
    expect(isPurchasable({ available: true, inventory_management: 'shopify', inventory_quantity: 0 })).toBe(true);
    expect(isPurchasable({ inventory_management: 'shopify', inventory_quantity: 0, inventory_policy: 'continue' })).toBe(true);
    expect(isPurchasable({ inventory_management: 'shopify', inventory_quantity: 0, inventory_policy: 'deny' })).toBe(false);
    expect(isPurchasable({ available: false, inventory_management: null })).toBe(false);
  });
});
