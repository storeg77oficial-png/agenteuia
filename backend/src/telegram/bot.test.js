jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../ai/training', () => ({ getReviewReplies: jest.fn(), addTrainingData: jest.fn() }));
jest.mock('../ai/learning', () => ({
  getLearningOverview: jest.fn(),
  addVocab: jest.fn(),
  setVocabStatus: jest.fn()
}));

const axios = require('axios');
const { query } = require('../db');
const training = require('../ai/training');
const bot = require('./bot');

describe('Telegram supervised training commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(global, 'setTimeout').mockImplementation(() => 0);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    axios.get.mockResolvedValue({ data: { result: [] } });
    axios.post.mockResolvedValue({ data: { ok: true } });
    query.mockResolvedValue({ rows: [{ id: 'tenant-1' }] });
    training.addTrainingData.mockResolvedValue({ id: 'rule-1' });
    bot.startTelegramBot('test-token', '12345');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('stores an FAQ correction from the configured admin chat', async () => {
    await bot.handleCommand('12345', '/entrenar ¿Cuáles son los horarios? | Atendemos de lunes a sábado.', 'Admin');

    expect(training.addTrainingData).toHaveBeenCalledWith('tenant-1', {
      category: 'faq',
      question: '¿Cuáles son los horarios?',
      answer: 'Atendemos de lunes a sábado.'
    });
  });

  test('rejects training commands from chats other than the configured admin chat', async () => {
    await bot.handleCommand('99999', '/entrenar pregunta | respuesta', 'Otro');

    expect(query).not.toHaveBeenCalled();
    expect(training.addTrainingData).not.toHaveBeenCalled();
  });
});
