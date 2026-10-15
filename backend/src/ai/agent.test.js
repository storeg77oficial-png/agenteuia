jest.mock('../shopify/products', () => ({}));
jest.mock('../shopify/orders', () => ({}));
jest.mock('./training', () => ({ getTrainingData: jest.fn() }));
jest.mock('../db/redis', () => ({ cacheGet: jest.fn(), cacheSet: jest.fn() }));
jest.mock('./seller', () => ({ handleSellerTurn: jest.fn() }));

const { processWithAI } = require('./agent');

const tenant = { id: 'tenant-1', business_name: 'STORE SG MEDELLÍN' };
const newSession = () => ({ state: 'new', context: {}, messageCount: 0 });

describe('welcome greeting', () => {
  afterEach(() => jest.useRealTimers());

  const greetAt = async (isoUtc, customer) => {
    jest.useFakeTimers().setSystemTime(new Date(isoUtc));
    return (await processWithAI(tenant, customer, newSession(), 'Hola', 'text')).text;
  };

  test('uses the store welcome text, the customer name and the Bogota time of day', async () => {
    expect(await greetAt('2026-10-16T03:30:00Z', { name: 'storeg' })).toBe(
      'Buenas noches Storeg! 👋 Bienvenido a *STORE SG MEDELLÍN*.\n\n' +
      'Tenemos la mejor ropa de Medellín para mujeres, hombres y kids.\n\n' +
      'Cuéntame, ¿cómo te podemos ayudar?'
    );
  });

  test('switches between morning, afternoon and night by Colombian time, not server time', async () => {
    expect(await greetAt('2026-10-15T15:42:00Z', { name: 'Sebastian' })).toMatch(/^Buenos días Sebastian!/);
    expect(await greetAt('2026-10-15T20:00:00Z', { name: 'Sebastian' })).toMatch(/^Buenas tardes Sebastian!/);
  });

  test('greets without a name when the account has none', async () => {
    expect(await greetAt('2026-10-15T15:00:00Z', { name: 'Cliente' })).toMatch(/^Buenos días! 👋/);
  });
});
