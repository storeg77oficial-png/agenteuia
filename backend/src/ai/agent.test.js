jest.mock('../shopify/products', () => ({}));
jest.mock('../shopify/orders', () => ({}));
jest.mock('./training', () => ({ getTrainingData: jest.fn() }));
jest.mock('../db/redis', () => ({ cacheGet: jest.fn(), cacheSet: jest.fn() }));
jest.mock('./seller', () => ({ handleSellerTurn: jest.fn() }));

const { processWithAI } = require('./agent');
const { handleSellerTurn } = require('./seller');
const { getTrainingData } = require('./training');

const tenant = { id: 'tenant-1', business_name: 'STORE SG MEDELLÍN' };
const newSession = () => ({ state: 'new', context: {}, messageCount: 0 });

describe('conversation loop protection', () => {
  const unsure = { text: '¿Qué talla buscas?', intent: 'product_search', confidence: 0.8, state: 'browsing', context: {}, transferToHuman: false };
  const sessionWith = lastReply => ({
    state: 'browsing', messageCount: 3,
    context: { history: [{ role: 'user', content: 'Camiseta Nike' }, { role: 'assistant', content: lastReply }] }
  });

  test('hands over to a person instead of repeating the same unsure answer', async () => {
    handleSellerTurn.mockResolvedValue(unsure);

    const result = await processWithAI(tenant, { name: 'Ana' }, sessionWith('¿Qué talla buscas?'), 'Camiseta Nike', 'text');

    expect(result.transferToHuman).toBe(true);
    expect(result.text).toContain('siento estar repitiéndome');
  });

  test('keeps answering when the reply is not a repeat', async () => {
    handleSellerTurn.mockResolvedValue(unsure);

    const result = await processWithAI(tenant, { name: 'Ana' }, sessionWith('Otra respuesta'), 'Camiseta Nike', 'text');

    expect(result.transferToHuman).toBe(false);
    expect(result.text).toBe('¿Qué talla buscas?');
  });
});

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

describe('supervised FAQ learning', () => {
  test('matches a short customer question to a corrected FAQ despite punctuation and filler words', async () => {
    getTrainingData.mockResolvedValue([{
      question: '¿Cuáles son los horarios?',
      answer: 'Atendemos de lunes a sábado.'
    }]);

    const result = await processWithAI(tenant, { name: 'Ana' }, newSession(), 'Horarios?', 'text');

    expect(result.text).toBe('Atendemos de lunes a sábado.');
    expect(getTrainingData).toHaveBeenCalledWith('tenant-1');
  });
});
