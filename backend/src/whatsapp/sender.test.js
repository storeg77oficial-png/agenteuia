jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn() }
}));

const axios = require('axios');
const { logger } = require('../utils/logger');
const { sendMessage } = require('./sender');

describe('Meta WhatsApp sender', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789012345';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
    process.env.WHATSAPP_API_VERSION = 'v25.0';
    delete process.env.WHATSAPP_REQUEST_TIMEOUT_MS;
  });

  afterAll(() => {
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_API_VERSION;
    delete process.env.WHATSAPP_REQUEST_TIMEOUT_MS;
  });

  test('normalizes recipients and sends through the configured Meta endpoint', async () => {
    axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.test' }] } });

    await sendMessage({}, '+57 300 123 4567', 'Hola');

    expect(axios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/123456789012345/messages',
      expect.objectContaining({ to: '573001234567', text: { preview_url: false, body: 'Hola' } }),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-access-token' }),
        timeout: 15000
      })
    );
  });

  test('logs Meta diagnostics without logging credentials and rethrows the request error', async () => {
    const error = Object.assign(new Error('Request failed'), {
      response: {
        status: 400,
        data: { error: { message: 'Invalid parameter', code: 100, fbtrace_id: 'trace-id' } }
      }
    });
    axios.post.mockRejectedValue(error);

    await expect(sendMessage({}, '573001234567', 'Hola')).rejects.toBe(error);

    expect(logger.error).toHaveBeenCalledWith('Meta WhatsApp API request failed', expect.objectContaining({
      httpStatus: 400,
      errorCode: 100,
      fbtraceId: 'trace-id'
    }));
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('test-access-token');
  });
});