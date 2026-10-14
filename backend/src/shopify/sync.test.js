jest.mock('../db', () => ({ query: jest.fn(), isLocal: true }));
jest.mock('axios', () => ({ get: jest.fn() }));

const { syncCatalog } = require('./sync');

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
});
