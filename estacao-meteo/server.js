'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pkg = require('./package.json');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';               // chave que o Arduino envia
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''; // password para alterar definições
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FICHEIRO = path.join(DATA_DIR, 'dados.json');
const MAX_LEITURAS = 20000; // ~27h a 1 leitura / 5 s
const MAX_ALERTAS = 500;

const SENSORES = ['temp', 'hum', 'gas', 'ldr', 'mq4'];
const LIMITES_VALIDOS = {
  temp: [-50, 100],
  hum: [0, 100],
  gas: [0, 1023],
  ldr: [0, 1023],
  mq4: [0, 100],
};

const PADRAO = {
  offlineSegundos: 60,
  // Cores do ecrã físico (RGB em hexadecimal)
  cores: {
    fundo: '#000000',
    titulo: '#0000ff',
    alerta: '#ff0000',
    valor: '#ffffff',
    temp: '#ffa500',
    hum: '#00ffff',
    gas: '#ffff00',
    ldr: '#00ff00',
    mq4: '#ff0000',
  },
  sensores: {
    temp: { ativo: true, min: 0, max: 35 },
    hum: { ativo: true, min: null, max: 90 },
    gas: { ativo: true, min: null, max: 400 },
    ldr: { ativo: false, min: null, max: null },
    mq4: { ativo: true, min: null, max: 50 },
  },
};

// ---------- Estado + persistência ----------
let leituras = [];
let alertas = [];
let definicoes = JSON.parse(JSON.stringify(PADRAO));
const ativos = new Map(); // "sensor:tipo" -> alerta em curso
let sujo = false;
let proxId = 1;

function carregar() {
  try {
    const d = JSON.parse(fs.readFileSync(FICHEIRO, 'utf8'));
    leituras = Array.isArray(d.leituras) ? d.leituras : [];
    alertas = Array.isArray(d.alertas) ? d.alertas : [];
    if (d.definicoes && d.definicoes.sensores) {
      definicoes = { ...PADRAO, ...d.definicoes,
        sensores: { ...PADRAO.sensores, ...d.definicoes.sensores },
        cores: { ...PADRAO.cores, ...(d.definicoes.cores || {}) } };
    }
    proxId = alertas.reduce((m, a) => Math.max(m, a.id), 0) + 1;
    alertas.filter(a => !a.fim).forEach(a => ativos.set(`${a.sensor}:${a.tipo}`, a));
    console.log(`[DADOS] ${leituras.length} leituras e ${alertas.length} alertas carregados.`);
  } catch (e) {
    console.log('[DADOS] Sem ficheiro anterior, a começar do zero.');
  }
}

function guardar() {
  if (!sujo) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FICHEIRO + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ leituras, alertas, definicoes }));
    fs.renameSync(tmp, FICHEIRO);
    sujo = false;
  } catch (e) {
    console.error('[DADOS] Erro ao guardar:', e.message);
  }
}

// ---------- Alertas ----------
function avaliar(l) {
  const res = [];
  for (const s of SENSORES) {
    const c = definicoes.sensores[s];
    if (!c || !c.ativo) continue;
    const v = l[s];
    if (c.max != null && v > c.max) res.push({ sensor: s, tipo: 'alto', valor: v, limite: c.max });
    if (c.min != null && v < c.min) res.push({ sensor: s, tipo: 'baixo', valor: v, limite: c.min });
  }
  return res;
}

function processarAlertas(l) {
  const agora = l.t;
  const atuais = new Map(avaliar(l).map(a => [`${a.sensor}:${a.tipo}`, a]));

  for (const [chave, a] of atuais) {
    const existente = ativos.get(chave);
    if (!existente) {
      const novo = { id: proxId++, sensor: a.sensor, tipo: a.tipo, valor: a.valor, pico: a.valor,
                     limite: a.limite, inicio: agora, fim: null };
      alertas.push(novo);
      ativos.set(chave, novo);
      console.log(`[ALERTA] ${a.sensor} ${a.tipo}: ${a.valor} (limite ${a.limite})`);
    } else {
      existente.limite = a.limite;
      existente.valor = a.valor;
      existente.pico = a.tipo === 'alto' ? Math.max(existente.pico, a.valor) : Math.min(existente.pico, a.valor);
    }
  }
  for (const [chave, a] of ativos) {
    if (!atuais.has(chave)) {
      a.fim = agora;
      ativos.delete(chave);
    }
  }
  while (alertas.length > MAX_ALERTAS) alertas.shift();
  sujo = true;
}

// ---------- Cores do ecrã ----------
const CAMPOS_CORES = ['fundo', 'titulo', 'alerta', 'valor', 'temp', 'hum', 'gas', 'ldr', 'mq4'];
const HEX = /^#[0-9a-fA-F]{6}$/;
function rgb565(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}
// Valores RGB565 em hexadecimal separados por vírgula, pela ordem de CAMPOS_CORES
function cabecalhoCores() {
  return CAMPOS_CORES.map(k => rgb565(definicoes.cores[k]).toString(16).padStart(4, '0')).join(',');
}

// ---------- Utilitários ----------
function hash(s) { return crypto.createHash('sha256').update(String(s)).digest(); }
function igual(a, b) { return crypto.timingSafeEqual(hash(a), hash(b)); }

function numero(x) {
  if (x === undefined || x === null || x === '') return null;
  const n = Number(String(x).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function exigirChave(req, res, next) {
  if (!API_KEY) return next();
  const k = req.query.key || req.get('x-api-key') || (req.body && req.body.key) || '';
  if (!igual(k, API_KEY)) return res.status(401).json({ ok: false, erro: 'Chave inválida' });
  next();
}

function exigirAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return next();
  if (!igual(req.get('x-admin-password') || '', ADMIN_PASSWORD)) {
    return res.status(401).json({ erro: 'Password de administrador incorreta' });
  }
  next();
}

// ---------- App ----------
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/saude', (req, res) => {
  res.json({ ok: true, versao: pkg.version, commit: (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7) });
});

// O Arduino envia aqui (GET ou POST): /api/leitura?key=...&temp=..&hum=..&gas=..&ldr=..&mq4=..
app.all('/api/leitura', exigirChave, (req, res) => {
  const origem = { ...req.query, ...(req.body || {}) };
  const l = { t: Date.now() };
  for (const s of SENSORES) {
    const v = numero(origem[s]);
    const [min, max] = LIMITES_VALIDOS[s];
    if (v === null || Number.isNaN(v) || v < min || v > max) {
      return res.status(400).json({ ok: false, erro: `Valor inválido para "${s}"` });
    }
    l[s] = v;
  }
  leituras.push(l);
  if (leituras.length > MAX_LEITURAS) leituras.splice(0, leituras.length - MAX_LEITURAS);
  processarAlertas(l);
  const emAlerta = ativos.size > 0;
  res.set('X-Alerta', emAlerta ? '1' : '0');
  res.set('X-Cores', cabecalhoCores());
  res.json({ ok: true, alerta: emAlerta, ativos: ativos.size });
});

app.get('/api/estado', (req, res) => {
  const ultima = leituras[leituras.length - 1] || null;
  const segundos = ultima ? Math.round((Date.now() - ultima.t) / 1000) : null;
  res.json({
    ultima,
    segundos,
    online: ultima ? segundos <= definicoes.offlineSegundos : false,
    ativos: [...ativos.values()],
    definicoes,
    padraoCores: PADRAO.cores,
    versao: pkg.version,
    commit: (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7),
  });
});

app.get('/api/leituras', (req, res) => {
  const minutos = Math.min(Math.max(parseInt(req.query.minutos, 10) || 60, 1), 1440 * 7);
  const maxPontos = Math.min(Math.max(parseInt(req.query.max, 10) || 400, 10), 2000);
  const desde = Date.now() - minutos * 60000;
  let dados = leituras.filter(l => l.t >= desde);
  if (dados.length > maxPontos) {
    const passo = dados.length / maxPontos;
    dados = Array.from({ length: maxPontos }, (_, i) => dados[Math.floor(i * passo)]);
  }
  res.json(dados);
});

app.get('/api/alertas', (req, res) => {
  res.json([...alertas].reverse().slice(0, 100));
});

app.get('/api/definicoes', (req, res) => res.json(definicoes));

app.put('/api/definicoes', exigirAdmin, (req, res) => {
  try {
    const novo = JSON.parse(JSON.stringify(definicoes));
    const body = req.body || {};
    if (body.offlineSegundos !== undefined) {
      const o = numero(body.offlineSegundos);
      if (o === null || Number.isNaN(o) || o < 10 || o > 86400) throw new Error('Tempo offline deve estar entre 10 e 86400 s');
      novo.offlineSegundos = Math.round(o);
    }
    for (const s of SENSORES) {
      const c = body.sensores && body.sensores[s];
      if (!c) continue;
      const min = numero(c.min), max = numero(c.max);
      if (Number.isNaN(min) || Number.isNaN(max)) throw new Error(`Valores inválidos em ${s}`);
      if (min !== null && max !== null && min >= max) throw new Error(`Em ${s}, o mínimo tem de ser menor que o máximo`);
      novo.sensores[s] = { ativo: !!c.ativo, min, max };
    }
    if (body.cores) {
      for (const k of CAMPOS_CORES) {
        if (body.cores[k] === undefined) continue;
        if (!HEX.test(body.cores[k])) throw new Error(`Cor inválida em "${k}"`);
        novo.cores[k] = body.cores[k].toLowerCase();
      }
    }
    definicoes = novo;
    const ultima = leituras[leituras.length - 1];
    if (ultima) processarAlertas({ ...ultima, t: Date.now() });
    sujo = true;
    guardar();
    res.json(definicoes);
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

app.post('/api/definicoes/repor', exigirAdmin, (req, res) => {
  definicoes = JSON.parse(JSON.stringify(PADRAO));
  sujo = true;
  guardar();
  res.json(definicoes);
});

// ---------- Arranque ----------
carregar();
setInterval(guardar, 60000);
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => { guardar(); process.exit(0); });
}
app.listen(PORT, () => {
  console.log(`Estação Meteo v${pkg.version} a correr na porta ${PORT}`);
  if (!API_KEY) console.warn('[AVISO] API_KEY não definida: qualquer pessoa pode enviar leituras.');
  if (!ADMIN_PASSWORD) console.warn('[AVISO] ADMIN_PASSWORD não definida: qualquer pessoa pode mudar as definições.');
});
