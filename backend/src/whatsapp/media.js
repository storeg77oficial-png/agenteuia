/**
 * Incoming/outgoing media for the sales assistant:
 * voice note -> text, photo -> catalog search terms, text -> Colombian voice note.
 */
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const llm = require('../ai/llm');
const { logger } = require('../utils/logger');

const VOICE = process.env.TTS_VOICE || 'es-CO-SalomeNeural';
const TTS_PROVIDER = (process.env.TTS_PROVIDER || 'edge').toLowerCase();
const MAX_SPOKEN_CHARS = 700;

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', chunk => { stderr += chunk; });
    proc.on('error', reject);
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${stderr.slice(0, 200)}`))));
  });
}

async function convert(input, inExt, outExt, ffmpegArgs) {
  const id = crypto.randomBytes(8).toString('hex');
  const inPath = path.join(os.tmpdir(), `sg-${id}.${inExt}`);
  const outPath = path.join(os.tmpdir(), `sg-${id}.${outExt}`);
  try {
    await fs.writeFile(inPath, input);
    await runFfmpeg(['-i', inPath, ...ffmpegArgs, outPath]);
    return await fs.readFile(outPath);
  } finally {
    await Promise.allSettled([fs.rm(inPath, { force: true }), fs.rm(outPath, { force: true })]);
  }
}

/** Voice note (OGG/Opus from WhatsApp) -> Spanish text. Returns '' if nothing intelligible. */
async function transcribeAudio(buffer) {
  const wav = await convert(buffer, 'ogg', 'wav', ['-ar', '16000', '-ac', '1']);
  const data = `data:audio/wav;base64,${wav.toString('base64')}`;
  const text = await llm.chat([{
    role: 'user',
    content: [
      { type: 'input_audio', input_audio: { data } },
      { type: 'text', text: 'Transcribe literalmente este audio en español de Colombia. Puede mencionar marcas como Nike, Adidas, Burberry, Gucci, Calvin Klein, Lacoste, Versace o prendas de ropa y tallas. Responde solo con la transcripción, sin comentarios.' }
    ]
  }], { maxTokens: 400 });
  return (text || '').replace(/^["“]|["”]$/g, '').trim();
}

/** Customer photo -> what the garment is, so the catalog can be searched. */
async function describeImage(buffer, mime) {
  const dataUrl = `data:${mime || 'image/jpeg'};base64,${buffer.toString('base64')}`;
  const raw = await llm.chat([{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: dataUrl } },
      { type: 'text', text: 'Eres asistente de una tienda de ropa y accesorios de marca. Analiza la foto y responde SOLO un JSON con las claves: ' +
        '"es_prenda" (true/false), "tipo" (camiseta, sudadera, buzo, chaqueta, blusa, zapatos, bolso, gorra, jeans, conjunto, billetera u otro; ' +
        'en Colombia "sudadera" es el pantalón jogger/deportivo y "buzo" la prenda superior con capucha o cuello), ' +
        '"marca" (solo si se ve un logo o etiqueta legible, si no null), "color", "detalles" (estampado, cuello, mangas, etc., breve), ' +
        '"busqueda" (3 a 6 palabras en español para buscar este producto en un catálogo, ej. "camiseta burberry blanca").' }
    ]
  }], { maxTokens: 300 });

  const json = raw?.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed.es_prenda === false ? null : parsed;
  } catch (error) {
    return null;
  }
}

function numberToSpokenPrice(raw) {
  const value = parseInt(String(raw).replace(/[.,]/g, ''), 10);
  if (!Number.isFinite(value)) return raw;
  return value % 1000 === 0 ? `${value / 1000} mil pesos` : `${value} pesos`;
}

/** Strip anything a voice should not read out loud. */
function toSpoken(text) {
  let spoken = String(text || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\$\s?(\d{1,3}(?:[.,]\d{3})+|\d+)/g, (m, n) => numberToSpokenPrice(n))
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\uFE0F]/gu, '')
    .replace(/[*_#~`]/g, '')
    .replace(/^[•\-]\s*/gm, '')
    .replace(/\n+/g, '. ')
    .replace(/\.\s*\./g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  if (spoken.length > MAX_SPOKEN_CHARS) {
    const cut = spoken.slice(0, MAX_SPOKEN_CHARS);
    spoken = cut.slice(0, Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('?'), cut.lastIndexOf('!')) + 1) || cut;
  }
  return spoken;
}

/** Text -> OGG/Opus voice note with a Colombian female voice. */
async function synthesizeVoice(text) {
  const spoken = toSpoken(text);
  if (!spoken) throw new Error('Nothing to say');

  if (TTS_PROVIDER === 'elevenlabs') {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;
    if (!apiKey || !voiceId) {
      throw new Error('ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are required for ElevenLabs TTS');
    }

    const axios = require('axios');
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        text: spoken,
        model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true }
      },
      {
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        responseType: 'arraybuffer',
        timeout: parseInt(process.env.ELEVENLABS_TIMEOUT_MS, 10) || 30000
      }
    );
    return convert(Buffer.from(response.data), 'mp3', 'ogg', ['-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-application', 'voip']);
  }

  const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS);
  const { audioStream } = tts.toStream(spoken);
  const webm = await new Promise((resolve, reject) => {
    const chunks = [];
    audioStream.on('data', chunk => chunks.push(chunk));
    audioStream.on('end', () => resolve(Buffer.concat(chunks)));
    audioStream.on('error', reject);
  });
  if (!webm.length) throw new Error('Empty TTS audio');

  return convert(webm, 'webm', 'ogg', ['-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-application', 'voip']);
}

module.exports = { transcribeAudio, describeImage, synthesizeVoice, toSpoken };
