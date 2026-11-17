const express = require('express');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.API_KEY || '53d9eac4dd9fad04445268d6cebe3ba8';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Configuração do Supabase (variáveis de ambiente no Render)
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

if (supabase) {
  console.log('[SUPABASE] Cliente configurado com sucesso.');
} else {
  console.log('[SUPABASE] Aviso: SUPABASE_URL ou SUPABASE_KEY não definidos.');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Procura automaticamente por fundo.(png/jpg/jpeg/webp) ou icon.(png/jpg/jpeg/ico/webp) em public/
function encontrarFicheiroPublico(prefixo) {
  const exts = ['.png', '.jpg', '.jpeg', '.webp', '.ico', '.svg'];
  const pubDir = path.join(__dirname, 'public');
  for (const ext of exts) {
    const candidato = path.join(pubDir, prefixo + ext);
    if (fs.existsSync(candidato)) return candidato;
  }
  return null;
}

app.get('/fundo', (req, res) => {
  const ficheiro = encontrarFicheiroPublico('fundo');
  if (ficheiro) return res.sendFile(ficheiro);
  res.status(404).end();
});

app.get('/icon', (req, res) => {
  const ficheiro = encontrarFicheiroPublico('icon');
  if (ficheiro) return res.sendFile(ficheiro);
  res.status(404).end();
});

const CONFIG_FILE = path.join(__dirname, 'config.json');

const defaultConfig = {
  limites: {
    tempMax: 30,
    humMax: 80,
    gasMax: 400,
    mq4Max: 30,
    ldrMax: 950
  },
  // Ordem: fundo, titulo, alerta, valor, temp, hum, gas, ldr, mq4
  coresHex: [
    '#000000', // C_FUNDO
    '#0000FF', // C_TITULO
    '#FF0000', // C_ALERTA
    '#FFFFFF', // C_VALOR
    '#FFA500', // C_TEMP
    '#00FFFF', // C_HUM
    '#FFFF00', // C_GAS
    '#00FF00', // C_LDR
    '#FF0000'  // C_MQ4
  ]
};

function carregarConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        limites: { ...defaultConfig.limites, ...(parsed.limites || {}) },
        coresHex: Array.isArray(parsed.coresHex) && parsed.coresHex.length === 9
          ? parsed.coresHex
          : [...defaultConfig.coresHex]
      };
    }
  } catch (err) {
    console.error('[CONFIG] Erro ao ler config.json:', err.message);
  }
  return JSON.parse(JSON.stringify(defaultConfig));
}

function guardarConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('[CONFIG] Erro ao guardar config.json:', err.message);
  }
}

let config = carregarConfig();

function hexToRgb565(hex) {
  const clean = (hex || '#000000').replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;
  const rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
  return rgb565.toString(16).toUpperCase().padStart(4, '0');
}

const historico = [];
const MAX_HISTORICO = 100;

let estadoAtual = {
  temp: null,
  hum: null,
  gas: null,
  ldr: null,
  mq4: null,
  alerta: false,
  motivosAlerta: [],
  atualizadoEm: null
};

let comandoBuzzer = '';

// Controlo anti-spam para não gravar alertas duplicados a cada 5 segundos
let ultimoMotivoGuardado = '';
let ultimoAlertaGuardadoMs = 0;
const INTERVALO_REPETICAO_ALERTA_MS = 60000; // 1 minuto se o mesmo alerta continuar ativo

async function registarAlertaSupabase(leitura, motivos) {
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from('historico_alertas')
      .insert([{
        motivos: motivos.join(' • '),
        temp: leitura.temp,
        hum: leitura.hum,
        gas: leitura.gas,
        mq4: leitura.mq4,
        ldr: leitura.ldr
      }]);

    if (error) {
      console.error('[SUPABASE] Erro ao inserir alerta:', error.message);
    } else {
      console.log('[SUPABASE] Alerta guardado na base de dados:', motivos.join(' | '));
    }
  } catch (err) {
    console.error('[SUPABASE] Exceção ao guardar alerta:', err.message);
  }
}

function avaliarAlerta(leitura) {
  const motivos = [];
  const lim = config.limites;

  if (leitura.temp !== null && leitura.temp > lim.tempMax) {
    motivos.push(`Temperatura elevada (${leitura.temp.toFixed(1)} °C > ${lim.tempMax} °C)`);
  }
  if (leitura.hum !== null && leitura.hum > lim.humMax) {
    motivos.push(`Humidade elevada (${leitura.hum.toFixed(0)}% > ${lim.humMax}%)`);
  }
  if (leitura.gas !== null && leitura.gas > lim.gasMax) {
    motivos.push(`Gás/Fumo MQ-2 elevado (${leitura.gas} > ${lim.gasMax})`);
  }
  if (leitura.mq4 !== null && leitura.mq4 > lim.mq4Max) {
    motivos.push(`Metano MQ-4 elevado (${leitura.mq4}% > ${lim.mq4Max}%)`);
  }
  if (leitura.ldr !== null && leitura.ldr > lim.ldrMax) {
    motivos.push(`Luminosidade elevada (${leitura.ldr} > ${lim.ldrMax})`);
  }

  return motivos;
}

app.get('/api/leitura', async (req, res) => {
  const { key, temp, hum, gas, ldr, mq4 } = req.query;

  if (key !== API_KEY) {
    return res.status(401).send('API Key invalida');
  }

  const leitura = {
    temp: temp !== undefined ? parseFloat(temp) : null,
    hum: hum !== undefined ? parseFloat(hum) : null,
    gas: gas !== undefined ? parseInt(gas, 10) : null,
    ldr: ldr !== undefined ? parseInt(ldr, 10) : null,
    mq4: mq4 !== undefined ? parseInt(mq4, 10) : null,
    timestamp: new Date().toISOString()
  };

  const motivos = avaliarAlerta(leitura);
  const alerta = motivos.length > 0;

  // Se houver alerta novo, mudança de motivo ou passou 1 minuto desde o último registo, grava no Supabase
  if (alerta) {
    const assinatura = motivos.map(m => m.split('(')[0].trim()).join('|');
    const agora = Date.now();
    if (assinatura !== ultimoMotivoGuardado || (agora - ultimoAlertaGuardadoMs) >= INTERVALO_REPETICAO_ALERTA_MS) {
      ultimoMotivoGuardado = assinatura;
      ultimoAlertaGuardadoMs = agora;
      registarAlertaSupabase(leitura, motivos);
    }
  } else {
    ultimoMotivoGuardado = '';
  }

  estadoAtual = {
    ...leitura,
    alerta,
    motivosAlerta: motivos,
    atualizadoEm: leitura.timestamp
  };

  historico.push(leitura);
  if (historico.length > MAX_HISTORICO) {
    historico.shift();
  }

  res.set('X-Alerta', alerta ? '1' : '0');
  res.set('X-Cores', config.coresHex.map(hexToRgb565).join(','));

  if (comandoBuzzer) {
    res.set('X-Buzzer', comandoBuzzer);
    console.log(`[BUZZER] Comando enviado ao Arduino: ${comandoBuzzer}`);
    comandoBuzzer = '';
  }

  res.status(200).send('OK');
});

app.get('/api/dados', (req, res) => {
  res.json({
    atual: estadoAtual,
    historico,
    limites: config.limites,
    supabaseAtivo: Boolean(supabase)
  });
});

// Rota para ler o histórico permanente de alertas do Supabase
app.get('/api/alertas', async (req, res) => {
  if (!supabase) {
    return res.json({
      conectado: false,
      alertas: [],
      aviso: 'Configura SUPABASE_URL e SUPABASE_KEY nas variáveis de ambiente do Render.'
    });
  }

  try {
    const { data, error } = await supabase
      .from('historico_alertas')
      .select('*')
      .order('criado_em', { ascending: false })
      .limit(50);

    if (error) {
      return res.status(500).json({ conectado: true, alertas: [], erro: error.message });
    }

    res.json({ conectado: true, alertas: data || [] });
  } catch (err) {
    res.status(500).json({ conectado: true, alertas: [], erro: err.message });
  }
});

// Rota opcional para limpar histórico de testes (protegida pela mesma palavra-passe)
app.delete('/api/alertas', async (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ erro: 'Palavra-passe incorreta.' });
  }
  if (!supabase) {
    return res.status(400).json({ erro: 'Supabase não configurado.' });
  }

  try {
    const { error } = await supabase
      .from('historico_alertas')
      .delete()
      .gt('id', 0);

    if (error) {
      return res.status(500).json({ erro: error.message });
    }
    res.json({ ok: true, mensagem: 'Histórico de alertas limpo com sucesso.' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post('/api/buzzer', (req, res) => {
  const { som } = req.body || {};
  const permitidos = ['teste', 'mario', 'starwars', 'nokia', 'parabens'];

  if (!permitidos.includes(som)) {
    return res.status(400).json({ erro: 'Música ou som inválido.' });
  }

  comandoBuzzer = som;
  res.json({
    ok: true,
    mensagem: `Pedido enviado! O Arduino vai tocar "${som}" na próxima atualização (até 5s).`
  });
});

app.get('/api/config', (req, res) => {
  res.json(config);
});

app.post('/api/config', (req, res) => {
  const { password, limites, coresHex } = req.body || {};

  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ erro: 'Palavra-passe incorreta.' });
  }

  if (limites) {
    config.limites = {
      tempMax: Number(limites.tempMax) || defaultConfig.limites.tempMax,
      humMax: Number(limites.humMax) || defaultConfig.limites.humMax,
      gasMax: Number(limites.gasMax) || defaultConfig.limites.gasMax,
      mq4Max: Number(limites.mq4Max) || defaultConfig.limites.mq4Max,
      ldrMax: Number(limites.ldrMax) || defaultConfig.limites.ldrMax
    };
  }

  if (Array.isArray(coresHex) && coresHex.length === 9) {
    config.coresHex = coresHex;
  }

  guardarConfig(config);
  res.json({ ok: true, mensagem: 'Definições guardadas com sucesso!', config });
});

app.listen(PORT, () => {
  console.log(`Servidor ativo na porta ${PORT}`);
});
