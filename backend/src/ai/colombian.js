/**
 * Colombian (and Paisa) Spanish: slang, clothing vocabulary, spoken numbers and money talk.
 * Everything here works on accent-stripped lowercase text.
 */

const strip = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Chat abbreviations and voseo ("tenés", "mostrame") -> standard forms
const ABBREVIATIONS = {
  q: 'que', k: 'que', ke: 'que', xq: 'porque', pq: 'porque', porq: 'porque', x: 'por', pa: 'para', tb: 'tambien',
  tmb: 'tambien', bn: 'bien', ps: 'pues', pls: 'por favor', plis: 'por favor', porfa: 'por favor', porfis: 'por favor',
  xfa: 'por favor', kiero: 'quiero', bsco: 'busco', tnes: 'tienes', tenes: 'tienes', queres: 'quieres',
  mostrame: 'muestrame', decime: 'dime', pasame: 'pasame', mandame: 'mandame', dnd: 'donde', cuando: 'cuando',
  info: 'informacion', hay: 'hay', xl: 'xl', tll: 'talla', tlla: 'talla', msj: 'mensaje', grax: 'gracias', gracs: 'gracias'
};

const SIZE_WORDS = [
  [/\btalla (eme|mediana|mediano)\b/g, 'talla m'],
  [/\btalla (ele)\b/g, 'talla l'],
  [/\btalla (ese|pequena|pequeno)\b/g, 'talla s'],
  [/\b(doble equis ele|doble xl|2 equis ele|equis equis ele)\b/g, 'xxl'],
  [/\b(equis ele|extra grande|extra large|extra l)\b/g, 'xl'],
  [/\bequis ese\b/g, 'xs']
];

const UNITS = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90
};
const HUNDREDS = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600,
  setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900
};

/**
 * "doscientos cincuenta mil" -> "250000", "dos millones" -> "2000000".
 * Only sequences with a hundreds word, "mil" or "millon" are converted, so "una camiseta" stays intact.
 */
function convertNumberWords(text) {
  const tokens = text.split(' ');
  const out = [];
  let i = 0;

  while (i < tokens.length) {
    const isNum = w => w in UNITS || w in HUNDREDS || w === 'mil' || w === 'millon' || w === 'millones';
    if (!isNum(tokens[i])) { out.push(tokens[i]); i++; continue; }

    let j = i;
    const seq = [];
    while (j < tokens.length && (isNum(tokens[j]) || (tokens[j] === 'y' && j + 1 < tokens.length && isNum(tokens[j + 1]) && seq.length))) {
      if (tokens[j] !== 'y') seq.push(tokens[j]);
      j++;
    }

    const strong = seq.some(w => w in HUNDREDS || w === 'mil' || w === 'millon' || w === 'millones');
    if (!strong) { out.push(...tokens.slice(i, j)); i = j; continue; }

    let total = 0;
    let current = 0;
    for (const w of seq) {
      if (w in UNITS) current += UNITS[w];
      else if (w in HUNDREDS) current += HUNDREDS[w];
      else if (w === 'mil') { total += (current || 1) * 1000; current = 0; }
      else { total = (total + (current || 1)) * 1000000; current = 0; }
    }
    out.push(String(total + current));
    i = j;
  }
  return out.join(' ');
}

// "200 lucas" = $200.000, "un palo" = $1.000.000, "medio palo" = $500.000
function convertMoneySlang(text) {
  return text
    .replace(/\bpalo y medio\b/g, '1500000')
    .replace(/\bmedio palo\b/g, '500000')
    .replace(/\b(?:un|1) palo\b/g, '1000000')
    .replace(/\b(\d+) palos\b/g, (m, n) => String(n * 1000000))
    .replace(/\b(\d+) lucas?\b/g, (m, n) => String(n * 1000));
}

/** Lowercase, strip accents, fix chat spelling/voseo, and turn spoken numbers and money slang into digits. */
function normalizeSlang(raw) {
  let t = strip(raw).replace(/[^a-z0-9\s.,]/g, ' ').replace(/(?<!\d)[.,]|[.,](?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.split(' ').map(w => ABBREVIATIONS[w] || w).join(' ');
  for (const [pattern, replacement] of SIZE_WORDS) t = t.replace(pattern, replacement);
  t = convertNumberWords(t);
  return convertMoneySlang(t);
}

// Words that only add tone or politeness and must never become search terms
const FILLER_WORDS = ('parce parcero parcera pelao pelada mor mi amor mijo mija hermano hermana bro llave veci vecino ' +
  'pues ps ahorita ahora oiga oye mire digame disculpe disculpa perdon porfa favor quiubo quihubo quihubole hubo ' +
  'manejan manejas maneja venden vende consiguen consigue cuentan cuenta trabajan trabaja ofrecen mostrame muestrame ' +
  'regaleme regalame regalen regala regalas regalar regalo colabora colaboreme colaboras colaboran fotico foticos pantallazo mandame mandeme pasame ' +
  'paseme mandar pasar llevo llevar quedo quedan queda llego llegaron chimba bacano chevere melo buenisimo buenisima ' +
  'dale listo hagale claro obvio super mil gracias bueno buena buenas entonces sera seria serian podria pueden puede ' +
  'dime digame decime informacion info referencia referencias modelo modelos opciones opcion tienes tiene tenian ' +
  'cual cuales como cuanto cuanta precio precios vale valen valor costo cuesta cuestan').split(' ');

// Colombian color words -> stems that appear in store color names
const COLOR_ALIASES = {
  vinotinto: ['vino', 'vinotinto', 'burgundy'], vino: ['vino', 'vinotinto'], cafe: ['cafe', 'marron', 'chocolate'],
  marron: ['marron', 'cafe'], celeste: ['celeste', 'azul'], rosado: ['rosa', 'rosad'], rosa: ['rosa', 'rosad'],
  fucsia: ['fucsia', 'rosa'], crema: ['crema', 'beige', 'hueso'], hueso: ['hueso', 'crema', 'beige'],
  beige: ['beige', 'crema', 'arena'], arena: ['arena', 'beige'], anaranjado: ['naranja'], naranja: ['naranja'],
  oliva: ['oliva', 'verde'], militar: ['militar', 'verde'], lila: ['lila', 'morad'], violeta: ['violeta', 'morad'],
  morado: ['morad', 'lila'], plateado: ['plata', 'platead', 'gris'], dorado: ['dorad', 'oro'], rojo: ['roj'],
  roja: ['roj'], negro: ['negr'], negra: ['negr'], blanco: ['blanc'], blanca: ['blanc'], gris: ['gri'], azul: ['azul']
};

// Colombian clothing names -> store categories (a word may point to several)
const CATEGORY_SYNONYMS = {
  camisetas: ['camiseta', 'camisa', 'franela', 'playera', 'polo', 'tshirt', 't shirt', 'esqueleto', 'camisilla', 'oversize'],
  sudaderas: ['sudadera', 'jogger', 'joggers', 'pantalon deportivo', 'pants'],
  buzos: ['buzo', 'buso', 'hoodie', 'camibuzo'],
  chaquetas: ['chaqueta', 'cortavientos', 'rompevientos', 'chamarra', 'bomber', 'abrigo', 'gaban', 'ruana', 'poncho', 'jacket'],
  blusas: ['blusa', 'top', 'crop', 'camisola', 'body'],
  bolsos: ['bolso', 'cartera', 'morral', 'maleta', 'mochila', 'bag', 'rinonera', 'canguro'],
  billeteras: ['billetera', 'monedero', 'tarjetero', 'cartera'],
  zapatos: ['zapato', 'tenis', 'tennis', 'zapatilla', 'sneaker', 'sneakers', 'guayo', 'guayos', 'bota', 'botas', 'sandalia', 'chancla', 'chanclas', 'chola', 'cholas', 'mocasin'],
  jeans: ['jean', 'bluyin', 'pantalon', 'cargo'],
  gorras: ['gorra', 'cachucha', 'sombrero', 'gorro', 'beanie', 'bucket'],
  conjuntos: ['conjunto', 'set', 'dos piezas', 'pijama'],
  bikers: ['biker'],
  leggins: ['leggin', 'leggins', 'legging', 'leggings', 'licra', 'lycra', 'calzas', 'calza'],
  pantalonetas: ['pantaloneta', 'short', 'bermuda'],
  vestidos: ['vestido', 'enterizo'],
  faldas: ['falda'],
  medias: ['media', 'medias', 'tobillera', 'tobilleras'],
  interior: ['boxer', 'calzoncillo', 'tanga', 'brasier', 'sosten', 'bralette']
};

// Ambiguous words: search every category they can mean
const MULTI_CATEGORY_WORDS = {
  saco: ['buzos', 'chaquetas'], canguro: ['bolsos', 'buzos'], cartera: ['bolsos', 'billeteras'], pantalon: ['jeans', 'sudaderas']
};

// Intent vocabulary (Colombian phrasing), applied to normalizeSlang() output
const INTENT_PATTERNS = {
  availability: /\b(manejan|maneja|venden|vende|consiguen|cuentan con|trabajan|hay|tienen|tienes|tiene|quedan|queda|llegaron|les llego|disponible|disponibilidad)\b/,
  buy: /\b(me lo llevo|me la llevo|me los llevo|lo quiero|la quiero|lo compro|la compro|quiero comprar|quiero pedir|hacer el pedido|separe|separame|separeme|apartame|aparteme|reserveme|reservame|regaleme|me regala|me colabora|colaboreme|lo voy a llevar|voy a llevar|dame|deme)\b/,
  bargain: /\b(rebaja|descuento|mas barato|mejor precio|ultimo precio|precio final|me lo deja|lo deja en|me hace precio|promo|promocion|oferta|2x1|dos por uno)\b/,
  authenticity: /\b(es original|son originales|original\??|replica|aaa|calidad|primera|de primera|garantizado|es legit|legit|autentic)\b/,
  photo: /\b(foto|fotos|fotico|foticos|imagen|imagenes|pantallazo|captura|screenshot|video|como se ve|como queda)\b/,
  shipping: /\b(domicilio|envio|envios|mandan|despachan|despacho|a toda colombia|cuanto demora|cuanto se demora|llega|guia|servientrega|interrapidisimo|inter|coordinadora|envia|deprisa|tcc|mensajero|rappi|flete)\b/,
  pickup: /\b(donde quedan|donde queda|donde estan|ubicados|ubicacion|como llego|voy para alla|voy pa alla|puedo ir|pasar por|recoger|a que hora abren|a que hora cierran|abren|cierran|abierto|abiertos|domingos|festivos|horario)\b/,
  payment: /\b(nequi|daviplata|bancolombia|transferencia|consignacion|consignar|consigno|pse|tarjeta|efectivo|datafono|addi|sistecredito|cuotas|abono|fiado|credito|contraentrega|contra entrega|pago en casa|metodos? de pago|como pago|donde pago|a nombre de)\b/,
  warranty: /\b(garantia|cambio|cambiar|devolucion|devolver|se rompio|se daño|se dano|defecto|defectuoso|talla equivocada|no me quedo|me quedo grande|me quedo pequeno|me quedo chico)\b/,
  complaint: /\b(reclamo|queja|estafa|estafadores|pesimo|pesima|mal servicio|mala atencion|no me ha llegado|nunca llego|no responden|no contestan|me robaron|inconforme)\b/,
  greeting: /^((hola|holi|holis|buenas|buenos dias|buenas tardes|buenas noches|quiubo|quihubo|qui hubo|que hubo|que mas|hey|ey|alo|saludos|que tal|parce|parcero|mor|amor|mi amor)\s?)+$/,
  thanks: /^(gracias|mil gracias|listo gracias|ok gracias|dale gracias|muchas gracias|gracias parce|chao|adios|hasta luego|nos vemos)/
};

// Compact glossary for the LLM so it reads Colombian chat correctly
const GLOSSARY = [
  'JERGA COLOMBIANA (entiéndela, no la corrijas):',
  '- Saludos: "quiubo", "qué más", "buenas", "parce/parcero", "mor", "mi amor", "mijo/mija", "veci", "llave" = amigable, trátalo con calidez.',
  '- Compra: "me lo llevo", "regáleme", "me colabora con", "sepáremelo", "apártemelo", "de una" = quiere comprar o confirma. "Hágale", "dale", "listo", "de una" = sí/de acuerdo.',
  '- Disponibilidad: "¿manejan Nike?", "¿consiguen...?", "¿cuentan con...?", "¿hay en M?" = ¿tienen ese producto/talla?',
  '- Dinero: "una luca" = $1.000, "200 lucas" = $200.000, "un palo" = $1.000.000, "medio palo" = $500.000. "A cómo", "cuánto me sale", "qué valor" = ¿cuánto cuesta?',
  '- Precio/regateo: "¿no lo deja más barato?", "¿última oferta?" = pide descuento; NO inventes descuentos, usa solo los precios de los datos y ofrece pasarlo con un asesor.',
  '- Ropa: sudadera = pantalón jogger; buzo/hoodie = prenda superior con capucha; camibuzo = camiseta-buzo; pantaloneta = short; saco = chaqueta o buzo de punto (pregunta cuál); chaqueta/cortavientos/ruana; franela = camiseta; tenis = zapatillas deportivas; guayos = zapatos de fútbol; cartera = bolso de mujer; canguro = riñonera o buzo con capota (pregunta); media = calcetín; cachucha = gorra; licra/leggins = calzas; enterizo = jumpsuit; body = bodysuit; bóxer = ropa interior.',
  '- Tallas: "talla M/L/XL", "una M", "en L", "eme/ele/ese" dichas en voz, "equis ele" = XL, "doble equis ele" = XXL. Tallas de zapatos en números (36-45).',
  '- Colores: vinotinto = vino/burgundy, café = marrón, rosado = rosa, crema/hueso/beige = tonos claros, celeste = azul claro.',
  '- Envíos y pago: "domicilio", "contraentrega", "consigno", "Nequi", "Daviplata", "Bancolombia", "Addi", "Servientrega/Interrapidísimo/Coordinadora", "guía".',
  '- Reclamos: "estafa", "no me ha llegado", "pésimo servicio" = molestia seria: discúlpate con empatía y ofrece un asesor humano de inmediato.',
  '- Autenticidad: si preguntan "¿es original?", "¿es réplica?", "¿es AAA?", no afirmes autenticidad de marca; di la calidad que indica el nombre del producto en la tienda (ORIGINAL, PREMIUM, TURCA, etc.) y ofrece un asesor para más detalles.'
].join('\n');

module.exports = {
  strip, normalizeSlang, convertNumberWords, convertMoneySlang, FILLER_WORDS, COLOR_ALIASES,
  CATEGORY_SYNONYMS, MULTI_CATEGORY_WORDS, INTENT_PATTERNS, GLOSSARY
};
