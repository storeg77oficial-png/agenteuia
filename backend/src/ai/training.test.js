jest.mock('../db/index', () => ({ query: jest.fn() }));

const { query } = require('../db/index');
const { getTrainingData, addTrainingData, addInstruction, getReviewReplies, deactivateTrainingData, deactivateInstruction } = require('./training');

describe('supervised AI training data', () => {
  beforeEach(() => jest.clearAllMocks());

  test('validates question and answer lengths before writing', async () => {
    await expect(addTrainingData('tenant-1', { question: 'x', answer: 'ok' }))
      .rejects.toThrow('La pregunta debe tener entre 3 y 500 caracteres');
    expect(query).not.toHaveBeenCalled();
  });

  test('stores trimmed corrections scoped to the tenant', async () => {
    query.mockResolvedValue({ rows: [{ id: 'rule-1' }] });

    await addTrainingData('tenant-1', {
      category: 'correction', question: '  ¿Qué horarios tienen?  ', answer: '  Lunes a sábado.  '
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ai_training_data'), [
      'tenant-1', 'correction', '¿Qué horarios tienen?', 'Lunes a sábado.'
    ]);
  });

  test('keeps instructions out of FAQ answer matching', async () => {
    query.mockResolvedValue({ rows: [] });

    await getTrainingData('tenant-1');

    expect(query.mock.calls[0][0]).toContain("COALESCE(category, 'faq') <> 'instruction'");
  });

  test('stores a validated behavior instruction in its own category', async () => {
    query.mockResolvedValue({ rows: [{ id: 'instruction-1' }] });

    await addInstruction('tenant-1', '  No inventes promociones.  ');

    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ai_training_data'), [
      'tenant-1', 'instruction', 'Instrucción aprobada por la tienda', 'No inventes promociones.'
    ]);
  });

  test('lists recent AI responses for review and scopes a selected message', async () => {
    query.mockResolvedValue({ rows: [{ id: 'reply-1' }] });

    await getReviewReplies('tenant-1', 5);
    const [listSql, listParams] = query.mock.calls[0];
    expect(listSql).toContain("ai.sender_type = 'ai'");
    expect(listSql).toContain('LIMIT $2');
    expect(listSql).not.toContain('ai.ai_confidence < 0.6');
    expect(listParams).toEqual(['tenant-1', 5]);

    await getReviewReplies('tenant-1', 1, 'reply-1');
    const [selectedSql, selectedParams] = query.mock.calls[1];
    expect(selectedSql).toContain('AND ai.id = $2');
    expect(selectedParams).toEqual(['tenant-1', 'reply-1']);
  });

  test('deactivates a training item only for its tenant', async () => {
    query.mockResolvedValue({ rowCount: 1 });

    await expect(deactivateTrainingData('tenant-1', 'rule-1')).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE tenant_id = $1 AND id = $2'), ['tenant-1', 'rule-1']);
  });

  test('deactivates only behavior instructions in the instruction operation', async () => {
    query.mockResolvedValue({ rowCount: 1 });

    await expect(deactivateInstruction('tenant-1', 'instruction-1')).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("category = 'instruction'"), ['tenant-1', 'instruction-1']);
  });
});
