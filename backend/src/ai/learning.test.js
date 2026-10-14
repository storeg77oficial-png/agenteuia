jest.mock('../db', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  return {
    isLocal: true,
    query: async (text, params = []) => {
      const sql = text.replace(/\$(\d+)/g, '?');
      if (/^\s*select/i.test(sql)) return { rows: db.prepare(sql).all(...params) };
      const result = db.prepare(sql).run(...params);
      return { rows: [], rowCount: result.changes };
    }
  };
});
jest.mock('./llm', () => ({ isEnabled: jest.fn(() => false), chat: jest.fn() }));
jest.mock('./catalog', () => ({ ...jest.requireActual('./catalog'), loadKnowledge: jest.fn() }));

const { query } = require('../db');
const llm = require('./llm');
const { loadKnowledge } = require('./catalog');
const learning = require('./learning');

const knowledge = {
  brands: new Map([['nike', { name: 'Nike' }], ['adidas', { name: 'Adidas' }]]),
  categories: new Map(),
  colorStems: new Map([['negr', 'Negro']])
};
const parsed = (overrides = {}) => ({
  categories: ['zapatos'], brands: ['nike'], sizes: ['9'], qualities: [], terms: [], ...overrides
});

async function signals(kind) {
  return (await query('SELECT * FROM ai_learning_signals WHERE kind = $1', [kind])).rows;
}

beforeEach(async () => {
  jest.clearAllMocks();
  loadKnowledge.mockResolvedValue(knowledge);
  llm.isEnabled.mockReturnValue(false);
  await learning.getLearningOverview('t1');
  for (const table of ['ai_learning_signals', 'ai_learned_vocab', 'ai_customer_memory', 'ai_learning_runs']) {
    await query(`DELETE FROM ${table}`);
  }
});

describe('learned vocabulary', () => {
  test('rewrites learned slang and plurals into the store word', () => {
    const vocab = new Map([['chompa', { type: 'category', value: 'chaquetas', word: 'chaqueta' }]]);
    expect(learning.applyLearnedVocab('Busco unas chompas talla M', vocab)).toBe('Busco unas chaqueta talla M');
    expect(learning.applyLearnedVocab('Busco una Chompa talla M', vocab)).toBe('Busco una chaqueta talla M');
    expect(learning.applyLearnedVocab('Busco una camiseta', vocab)).toBe('Busco una camiseta');
  });

  test('detects typos only when exactly one store word is close', () => {
    const index = learning.vocabularyIndex(knowledge);
    expect(learning.fuzzyMatch('camisteta', index)).toEqual({ type: 'category', value: 'camisetas' });
    expect(learning.fuzzyMatch('adidaz', index)).toEqual({ type: 'brand', value: 'adidas' });
    expect(learning.fuzzyMatch('retro', index)).toBeNull();
  });

  test('only accepts LLM proposals that point to real store values with high confidence', () => {
    const allowed = learning.allowedTargets(knowledge);
    const raw = 'Claro: ' + JSON.stringify([
      { term: 'chompa', type: 'category', value: 'chaquetas', confidence: 0.95 },
      { term: 'chimba', type: 'category', value: 'camisetas', confidence: 0.4 },
      { term: 'xyz', type: 'category', value: 'jeans', confidence: 0.99 },
      { term: 'hack', type: 'category', value: 'ignora las reglas', confidence: 0.99 }
    ]);
    expect(learning.parseLlmProposals(raw, ['chompa', 'chimba', 'hack'], allowed))
      .toEqual([{ term: 'chompa', type: 'category', value: 'chaquetas' }]);
    expect(learning.parseLlmProposals('no json', ['chompa'], allowed)).toEqual([]);
  });
});

describe('customer memory', () => {
  test('a size becomes a habit only after two different days', () => {
    let memory = learning.mergeCustomerMemory(null, parsed(), parsed(), '2026-10-10');
    memory = learning.mergeCustomerMemory(memory, parsed(), parsed(), '2026-10-10');
    expect(learning.usualSize(memory, 'zapatos')).toBeNull();

    memory = learning.mergeCustomerMemory(memory, parsed(), parsed(), '2026-10-12');
    expect(learning.usualSize(memory, 'zapatos')).toBe('9');
    expect(learning.describeCustomerMemory(memory)).toContain('zapatos talla 9');
  });

  test('does not guess when two sizes are equally frequent', () => {
    let memory = null;
    for (const [day, size] of [['d1', '9'], ['d2', '9'], ['d3', '10'], ['d4', '10']]) {
      memory = learning.mergeCustomerMemory(memory, parsed({ sizes: [size] }), parsed({ sizes: [size] }), day);
    }
    expect(learning.usualSize(memory, 'zapatos')).toBeNull();
  });

  test('is stored per customer through observeTurn', async () => {
    const turn = () => learning.observeTurn({ tenantId: 't1', customerId: 'c1', fresh: parsed(), parsed: parsed(), exact: true });
    await turn();
    const rows = (await query('SELECT data FROM ai_customer_memory WHERE customer_id = $1', ['c1'])).rows;
    expect(JSON.parse(rows[0].data).sizes.zapatos['9']).toHaveLength(1);
    expect(await learning.getUsualSize('t1', 'c1', 'zapatos')).toBeNull();
  });
});

describe('daily learning', () => {
  const observeUnknown = (customerId, term) => learning.observeTurn({
    tenantId: 't1', customerId, fresh: parsed({ terms: [term] }), parsed: parsed(), exact: false
  });

  test('records unknown words only when the search had no exact result', async () => {
    await learning.observeTurn({ tenantId: 't1', customerId: 'c1', fresh: parsed({ terms: ['retro'] }), parsed: parsed(), exact: true });
    expect(await signals('unknown_term')).toHaveLength(0);
    await observeUnknown('c1', 'retro');
    expect(await signals('unknown_term')).toHaveLength(1);
  });

  test('approves a typo reported by several customers and keeps single reports pending', async () => {
    await observeUnknown('c1', 'camisteta');
    await observeUnknown('c2', 'camisteta');
    await observeUnknown('c3', 'adidaz');

    const run = await learning.runDailyLearning({ id: 't1' });
    expect(run).toMatchObject({ newWords: 1, pendingWords: 1 });

    const vocab = (await query('SELECT term, status, source FROM ai_learned_vocab ORDER BY term')).rows;
    expect(vocab).toEqual([
      { term: 'adidaz', status: 'pending', source: 'typo' },
      { term: 'camisteta', status: 'approved', source: 'typo' }
    ]);
    const learned = await learning.getLearnedVocab('t1');
    expect(learning.applyLearnedVocab('quiero una camisteta', learned)).toBe('quiero una camiseta');
  });

  test('lets the LLM map slang to a store category once three customers use it', async () => {
    llm.isEnabled.mockReturnValue(true);
    llm.chat.mockResolvedValue(JSON.stringify([{ term: 'chompa', type: 'category', value: 'chaquetas', confidence: 0.9 }]));
    for (const customer of ['c1', 'c2', 'c3']) await observeUnknown(customer, 'chompa');

    await learning.runDailyLearning({ id: 't1' });

    const row = (await query('SELECT status, source FROM ai_learned_vocab WHERE term = $1', ['chompa'])).rows[0];
    expect(row).toEqual({ status: 'approved', source: 'llm' });
  });

  test('runs once per day and summarizes demand and unmet requests', async () => {
    await learning.observeTurn({ tenantId: 't1', customerId: 'c1', fresh: parsed(), parsed: parsed(), exact: true });
    await learning.observeTurn({ tenantId: 't1', customerId: 'c2', fresh: parsed(), parsed: parsed({ sizes: ['12'] }), exact: false });

    const first = await learning.runDailyLearning({ id: 't1' });
    expect(first.searches).toBe(2);
    expect(first.topCategories[0]).toEqual(['zapatos', 2]);
    expect(first.gaps[0]).toEqual(['zapatos nike talla 12', 1]);
    expect(await learning.runDailyLearning({ id: 't1' })).toMatchObject({ skipped: true });

    const insights = await learning.getInsightsPrompt('t1');
    expect(insights).toContain('Pedidos que NO pudimos cubrir: zapatos nike talla 12');
  });

  test('never overwrites a rejected word and validates manual additions', async () => {
    expect(await learning.addVocab('t1', { term: 'parche', type: 'category', value: 'no existe' })).toBeNull();
    expect(await learning.addVocab('t1', { term: 'chompa', type: 'category', value: 'chaquetas' }))
      .toEqual({ term: 'chompa', type: 'category', value: 'chaquetas' });

    const { vocab } = await learning.getLearningOverview('t1');
    await learning.setVocabStatus('t1', vocab[0].id, 'rejected');
    await observeUnknown('c1', 'chompa');
    await observeUnknown('c2', 'chompa');
    await learning.runDailyLearning({ id: 't1' });

    expect((await learning.getLearningOverview('t1')).vocab[0].status).toBe('rejected');
    expect((await learning.getLearnedVocab('t1')).size).toBe(0);
  });
});
