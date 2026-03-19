const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'chave-secreta-desenvolvimento';

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${file.fieldname}-${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = ['.pdf', '.dwg', '.dxf', '.step', '.stp', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Tipo de arquivo não permitido'));
  }
});

app.use('/uploads', express.static(uploadDir));

const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error('❌ Erro ao conectar ao banco:', err);
    process.exit(1);
  }
  console.log('✅ Banco conectado');
  criarEstrutura();
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function hojeISO() {
  return new Date().toISOString();
}

async function criarEstrutura() {
  db.serialize(async () => {
    try {
      await run(`
        CREATE TABLE IF NOT EXISTS vendedores (
          id TEXT PRIMARY KEY,
          nome TEXT NOT NULL,
          login TEXT NOT NULL UNIQUE,
          senha TEXT NOT NULL,
          codigoAcesso TEXT NOT NULL UNIQUE,
          tipo TEXT NOT NULL DEFAULT 'vendedor',
          ativo INTEGER NOT NULL DEFAULT 1,
          dataCriacao TEXT NOT NULL
        )
      `);

      await run(`
        CREATE TABLE IF NOT EXISTS cotacoes (
          id TEXT PRIMARY KEY,
          vendedorId TEXT,
          cnpj TEXT,
          empresa TEXT,
          contato TEXT,
          email TEXT,
          telefone TEXT,
          descricao TEXT,
          material TEXT,
          quantidade TEXT,
          prazo TEXT,
          infoAdicional TEXT,
          status TEXT,
          dataCriacao TEXT,
          statusAtualizadoEm TEXT,
          dataAprovacao TEXT,
          observacoes TEXT,
          arquivos TEXT,
          linkOrcamento TEXT,
          valor REAL DEFAULT 0,
          FOREIGN KEY(vendedorId) REFERENCES vendedores(id)
        )
      `);

      await run(`
        CREATE TABLE IF NOT EXISTS visitas (
          id TEXT PRIMARY KEY,
          cotacaoId TEXT,
          vendedorId TEXT,
          empresa TEXT,
          endereco TEXT,
          contato TEXT,
          telefone TEXT,
          status TEXT,
          dataVisita TEXT,
          tecnico TEXT,
          observacoes TEXT,
          dataCriacao TEXT,
          statusAtualizadoEm TEXT,
          FOREIGN KEY(cotacaoId) REFERENCES cotacoes(id),
          FOREIGN KEY(vendedorId) REFERENCES vendedores(id)
        )
      `);

      await run(`
        CREATE TABLE IF NOT EXISTS arquivados (
          id TEXT PRIMARY KEY,
          tipo TEXT,
          subtipo TEXT,
          dados TEXT,
          dataArquivamento TEXT,
          motivo TEXT,
          vendedorId TEXT
        )
      `);

      await run(`
        CREATE TABLE IF NOT EXISTS contatos_historico (
          id TEXT PRIMARY KEY,
          cnpj TEXT,
          contato TEXT,
          email TEXT,
          telefone TEXT,
          dataInicio TEXT,
          dataFim TEXT,
          ativo INTEGER DEFAULT 1
        )
      `);

      const colunasCotacoes = await all(`PRAGMA table_info(cotacoes)`);
      const nomesCot = colunasCotacoes.map(c => c.name);
      if (!nomesCot.includes('statusAtualizadoEm')) {
        await run(`ALTER TABLE cotacoes ADD COLUMN statusAtualizadoEm TEXT`);
      }
      if (!nomesCot.includes('dataAprovacao')) {
        await run(`ALTER TABLE cotacoes ADD COLUMN dataAprovacao TEXT`);
      }
      if (!nomesCot.includes('linkOrcamento')) {
        await run(`ALTER TABLE cotacoes ADD COLUMN linkOrcamento TEXT`);
      }
      if (!nomesCot.includes('valor')) {
        await run(`ALTER TABLE cotacoes ADD COLUMN valor REAL DEFAULT 0`);
      }

      const colunasVisitas = await all(`PRAGMA table_info(visitas)`);
      const nomesVis = colunasVisitas.map(c => c.name);
      if (!nomesVis.includes('statusAtualizadoEm')) {
        await run(`ALTER TABLE visitas ADD COLUMN statusAtualizadoEm TEXT`);
      }

      const hash = bcrypt.hashSync('admin123', 10);
      const existeMaster = await get(`SELECT * FROM vendedores WHERE id = 'MASTER'`);
      if (!existeMaster) {
        await run(`
          INSERT INTO vendedores (id, nome, login, senha, codigoAcesso, tipo, ativo, dataCriacao)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, ['MASTER', 'Administrador', 'admin', hash, 'ADMIN', 'master', 1, hojeISO()]);
        console.log('✅ Admin criado: admin / admin123');
      } else {
        await run(`
          UPDATE vendedores
          SET nome = ?, login = ?, senha = ?, codigoAcesso = ?, tipo = ?, ativo = 1
          WHERE id = 'MASTER'
        `, ['Administrador', 'admin', hash, 'ADMIN', 'master']);
        console.log('✅ Admin resetado: admin / admin123');
      }

      await run(`UPDATE cotacoes SET statusAtualizadoEm = COALESCE(statusAtualizadoEm, dataCriacao)`);
      await run(`UPDATE visitas SET statusAtualizadoEm = COALESCE(statusAtualizadoEm, dataCriacao)`);
      console.log('✅ Estrutura pronta');
      iniciarAutomacao();
    } catch (error) {
      console.error('❌ Erro ao criar estrutura:', error);
      process.exit(1);
    }
  });
}

function normalizeCnpj(value = '') {
  return String(value).replace(/\D/g, '');
}

function validarDrive(link = '') {
  return typeof link === 'string' && link.includes('drive.google.com');
}

function mascararPeriodoBR(date) {
  return new Date(date).toLocaleDateString('pt-BR');
}

async function registrarContatoHistorico({ cnpj, contato, email, telefone }) {
  const cnpjLimpo = normalizeCnpj(cnpj);
  if (!cnpjLimpo || !contato || !email || !telefone) return;

  const atual = await get(`
    SELECT * FROM contatos_historico
    WHERE cnpj = ? AND ativo = 1 AND contato = ? AND email = ? AND telefone = ?
    LIMIT 1
  `, [cnpjLimpo, contato, email, telefone]);

  if (atual) return;

  await run(`UPDATE contatos_historico SET ativo = 0, dataFim = ? WHERE cnpj = ? AND ativo = 1`, [hojeISO(), cnpjLimpo]);
  await run(`
    INSERT INTO contatos_historico (id, cnpj, contato, email, telefone, dataInicio, ativo)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `, [`CH-${Date.now()}-${Math.round(Math.random() * 1e6)}`, cnpjLimpo, contato, email, telefone, hojeISO()]);
}

function signUser(user) {
  return jwt.sign({ id: user.id, nome: user.nome, tipo: user.tipo }, JWT_SECRET, { expiresIn: '8h' });
}

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ sucesso: false, erro: 'Token não fornecido' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ sucesso: false, erro: 'Token inválido' });
  }
}

function masterOnly(req, res, next) {
  if (req.usuario.tipo !== 'master') {
    return res.status(403).json({ sucesso: false, erro: 'Acesso negado' });
  }
  next();
}

async function arquivarRegistro(tipo, id, subtipo, motivo = '', vendedorId = null) {
  const tabela = tipo === 'visita' ? 'visitas' : 'cotacoes';
  const row = await get(`SELECT * FROM ${tabela} WHERE id = ?`, [id]);
  if (!row) return false;

  const payload = {
    ...row,
    arquivos: row.arquivos ? JSON.parse(row.arquivos) : []
  };

  await run(`
    INSERT OR REPLACE INTO arquivados (id, tipo, subtipo, dados, dataArquivamento, motivo, vendedorId)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [id, tipo, subtipo, JSON.stringify(payload), hojeISO(), motivo, vendedorId || row.vendedorId || null]);

  await run(`DELETE FROM ${tabela} WHERE id = ?`, [id]);
  return true;
}

let automacaoLigada = false;
function iniciarAutomacao() {
  if (automacaoLigada) return;
  automacaoLigada = true;

  setInterval(async () => {
    try {
      const cotacoes = await all(`SELECT * FROM cotacoes`);
      const agora = Date.now();
      for (const c of cotacoes) {
        const base = new Date(c.statusAtualizadoEm || c.dataCriacao || hojeISO()).getTime();
        const dias = Math.floor((agora - base) / 86400000);

        if (c.status === 'Orçamento Enviado' && dias >= 7) {
          await run(`UPDATE cotacoes SET status = ?, statusAtualizadoEm = ? WHERE id = ?`, ['Sem Retorno', hojeISO(), c.id]);
        } else if (c.status === 'Sem Retorno' && dias >= 7) {
          await arquivarRegistro('cotacao', c.id, 'sem_retorno', 'Arquivado automaticamente por falta de retorno', c.vendedorId);
        } else if (c.status === 'Pedido Aprovado' && dias >= 7) {
          await arquivarRegistro('cotacao', c.id, 'aprovado', 'Arquivado automaticamente após aprovação', c.vendedorId);
        }
      }
    } catch (error) {
      console.error('❌ Erro na automação:', error.message);
    }
  }, 60 * 60 * 1000);
}

app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.post('/api/login', async (req, res) => {
  try {
    const { usuario, senha } = req.body;
    const row = await get(`SELECT * FROM vendedores WHERE login = ? AND ativo = 1`, [usuario]);
    if (!row) return res.json({ sucesso: false, erro: 'Usuário não encontrado' });
    if (!bcrypt.compareSync(senha, row.senha)) {
      return res.json({ sucesso: false, erro: 'Senha incorreta' });
    }
    return res.json({
      sucesso: true,
      token: signUser(row),
      usuario: { id: row.id, nome: row.nome, tipo: row.tipo, codigoAcesso: row.codigoAcesso }
    });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.get('/api/verificar-token', auth, (req, res) => {
  res.json({ sucesso: true, usuario: req.usuario });
});

app.get('/api/vendedores/codigo/:codigo', async (req, res) => {
  try {
    const codigo = String(req.params.codigo || '').toUpperCase();
    const vendedor = await get(`SELECT id, nome, codigoAcesso FROM vendedores WHERE codigoAcesso = ? AND ativo = 1`, [codigo]);
    if (!vendedor) return res.json({ sucesso: false, vendedor: null });
    res.json({ sucesso: true, vendedor });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.get('/api/vendedores', auth, masterOnly, async (_, res) => {
  try {
    res.json(await all(`SELECT id, nome, login, codigoAcesso, tipo, ativo, dataCriacao FROM vendedores ORDER BY nome`));
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.post('/api/vendedores', auth, masterOnly, async (req, res) => {
  try {
    const { nome, login, senha, codigoAcesso, tipo } = req.body;
    const codigo = String(codigoAcesso || '').toUpperCase();
    if (codigo.length !== 6) return res.status(400).json({ sucesso: false, erro: 'Código deve ter 6 caracteres' });
    const id = `VND-${Date.now()}`;
    await run(`
      INSERT INTO vendedores (id, nome, login, senha, codigoAcesso, tipo, ativo, dataCriacao)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `, [id, nome, login, bcrypt.hashSync(senha, 10), codigo, tipo || 'vendedor', hojeISO()]);
    res.json({ sucesso: true, id });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.put('/api/vendedores/:id', auth, masterOnly, async (req, res) => {
  try {
    const { nome, login, codigoAcesso, tipo, ativo } = req.body;
    const codigo = codigoAcesso ? String(codigoAcesso).toUpperCase() : null;
    if (codigo && codigo.length !== 6) return res.status(400).json({ sucesso: false, erro: 'Código deve ter 6 caracteres' });
    await run(`
      UPDATE vendedores
      SET nome = ?, login = ?, codigoAcesso = COALESCE(?, codigoAcesso), tipo = ?, ativo = ?
      WHERE id = ?
    `, [nome, login, codigo, tipo, ativo ? 1 : 0, req.params.id]);
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.put('/api/vendedores/:id/senha', auth, async (req, res) => {
  try {
    if (req.usuario.tipo !== 'master' && req.usuario.id !== req.params.id) {
      return res.status(403).json({ sucesso: false, erro: 'Acesso negado' });
    }
    await run(`UPDATE vendedores SET senha = ? WHERE id = ?`, [bcrypt.hashSync(req.body.senha, 10), req.params.id]);
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.delete('/api/vendedores/:id', auth, masterOnly, async (req, res) => {
  try {
    if (req.params.id === 'MASTER') return res.status(400).json({ sucesso: false, erro: 'Não é possível excluir o admin principal' });
    await run(`DELETE FROM vendedores WHERE id = ?`, [req.params.id]);
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.get('/api/clientes/:cnpj', async (req, res) => {
  try {
    const cnpj = normalizeCnpj(req.params.cnpj);
    const row = await get(`
      SELECT cnpj, empresa, contato, email, telefone
      FROM cotacoes
      WHERE cnpj = ?
      ORDER BY dataCriacao DESC
      LIMIT 1
    `, [cnpj]);

    if (row) return res.json({ encontrado: true, cliente: row });

    const arquivado = await get(`SELECT dados FROM arquivados WHERE tipo = 'cotacao' ORDER BY dataArquivamento DESC`);
    if (arquivado) {
      try {
        const dados = JSON.parse(arquivado.dados);
        if (normalizeCnpj(dados.cnpj) === cnpj) {
          return res.json({
            encontrado: true,
            cliente: { cnpj, empresa: dados.empresa, contato: dados.contato, email: dados.email, telefone: dados.telefone }
          });
        }
      } catch {}
    }

    res.json({ encontrado: false });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.get('/api/clientes', auth, async (req, res) => {
  try {
    const ativos = await all(`SELECT * FROM cotacoes`);
    const arquivados = await all(`SELECT * FROM arquivados WHERE tipo = 'cotacao'`);
    const todos = [
      ...ativos.map(c => ({ ...c, arquivos: c.arquivos ? JSON.parse(c.arquivos) : [] })),
      ...arquivados.map(a => JSON.parse(a.dados))
    ];

    const mapa = new Map();
    for (const item of todos) {
      const cnpj = normalizeCnpj(item.cnpj);
      if (!cnpj) continue;
      if (!mapa.has(cnpj)) mapa.set(cnpj, []);
      mapa.get(cnpj).push(item);
    }

    const clientes = [];
    for (const [cnpj, historico] of mapa.entries()) {
      historico.sort((a, b) => new Date(b.dataCriacao) - new Date(a.dataCriacao));
      const ultimo = historico[0];
      const contatos = [];
      const vistos = new Set();
      for (const h of historico) {
        const chave = `${h.contato || ''}|${h.email || ''}|${h.telefone || ''}`;
        if (!vistos.has(chave) && (h.contato || h.email || h.telefone)) {
          vistos.add(chave);
          contatos.push({ contato: h.contato || '', email: h.email || '', telefone: h.telefone || '' });
        }
      }
      clientes.push({
        cnpj,
        empresa: ultimo.empresa || '',
        totalCompras: historico.filter(h => h.status === 'Pedido Aprovado').reduce((s, h) => s + Number(h.valor || 0), 0),
        contatos,
        historico
      });
    }

    clientes.sort((a, b) => a.empresa.localeCompare(b.empresa, 'pt-BR'));
    res.json(clientes);
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.delete('/api/clientes/:cnpj', auth, masterOnly, async (req, res) => {
  try {
    const cnpj = normalizeCnpj(req.params.cnpj);
    await run(`DELETE FROM cotacoes WHERE cnpj = ?`, [cnpj]);
    const arquivados = await all(`SELECT id, dados FROM arquivados WHERE tipo = 'cotacao'`);
    for (const item of arquivados) {
      try {
        const dados = JSON.parse(item.dados);
        if (normalizeCnpj(dados.cnpj) === cnpj) {
          await run(`DELETE FROM arquivados WHERE id = ?`, [item.id]);
        }
      } catch {}
    }
    await run(`DELETE FROM contatos_historico WHERE cnpj = ?`, [cnpj]);
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.get('/api/cotacoes', auth, async (req, res) => {
  try {
    let query = `SELECT * FROM cotacoes`;
    const params = [];
    if (req.usuario.tipo !== 'master') {
      query += ` WHERE vendedorId = ?`;
      params.push(req.usuario.id);
    }
    query += ` ORDER BY dataCriacao DESC`;
    const rows = await all(query, params);
    res.json(rows.map(r => ({ ...r, arquivos: r.arquivos ? JSON.parse(r.arquivos) : [] })));
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.post('/api/cotacoes', async (req, res) => {
  try {
    const {
      vendedorId, cnpj, empresa, contato, email, telefone, descricao,
      material, quantidade, prazo, infoAdicional, status, arquivos
    } = req.body;

    if (!empresa || !contato || !email || !telefone || !descricao) {
      return res.status(400).json({ sucesso: false, erro: 'Preencha os campos obrigatórios' });
    }

    const id = req.body.id || `COT-${Date.now()}${Math.round(Math.random() * 1000)}`;
    const data = hojeISO();
    await run(`
      INSERT INTO cotacoes (
        id, vendedorId, cnpj, empresa, contato, email, telefone, descricao,
        material, quantidade, prazo, infoAdicional, status, dataCriacao,
        statusAtualizadoEm, arquivos, valor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      vendedorId || null,
      normalizeCnpj(cnpj),
      empresa,
      contato,
      email,
      telefone,
      descricao,
      material || '',
      quantidade || '',
      prazo || '',
      infoAdicional || '',
      status || 'Novo Orçamento',
      data,
      data,
      JSON.stringify(arquivos || []),
      0
    ]);

    await registrarContatoHistorico({ cnpj, contato, email, telefone });
    res.json({ sucesso: true, id });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.put('/api/cotacoes/:id', auth, async (req, res) => {
  try {
    const atual = await get(`SELECT * FROM cotacoes WHERE id = ?`, [req.params.id]);
    if (!atual) return res.status(404).json({ sucesso: false, erro: 'Cotação não encontrada' });

    const novoStatus = req.body.status ?? atual.status;
    const statusAtualizadoEm = novoStatus !== atual.status ? hojeISO() : (atual.statusAtualizadoEm || hojeISO());
    const dataAprovacao = novoStatus === 'Pedido Aprovado'
      ? (req.body.dataAprovacao || atual.dataAprovacao || hojeISO())
      : atual.dataAprovacao;

    if (novoStatus === 'Orçamento Enviado' && req.body.linkOrcamento && !validarDrive(req.body.linkOrcamento)) {
      return res.status(400).json({ sucesso: false, erro: 'O link deve ser do Google Drive' });
    }

    await run(`
      UPDATE cotacoes
      SET empresa = ?, contato = ?, email = ?, telefone = ?, descricao = ?, material = ?, quantidade = ?,
          prazo = ?, infoAdicional = ?, status = ?, statusAtualizadoEm = ?, observacoes = ?,
          linkOrcamento = ?, valor = ?, dataAprovacao = ?
      WHERE id = ?
    `, [
      req.body.empresa ?? atual.empresa,
      req.body.contato ?? atual.contato,
      req.body.email ?? atual.email,
      req.body.telefone ?? atual.telefone,
      req.body.descricao ?? atual.descricao,
      req.body.material ?? atual.material,
      req.body.quantidade ?? atual.quantidade,
      req.body.prazo ?? atual.prazo,
      req.body.infoAdicional ?? atual.infoAdicional,
      novoStatus,
      statusAtualizadoEm,
      req.body.observacoes ?? atual.observacoes,
      req.body.linkOrcamento ?? atual.linkOrcamento,
      Number(req.body.valor ?? atual.valor ?? 0),
      dataAprovacao,
      req.params.id
    ]);

    await registrarContatoHistorico({
      cnpj: req.body.cnpj ?? atual.cnpj,
      contato: req.body.contato ?? atual.contato,
      email: req.body.email ?? atual.email,
      telefone: req.body.telefone ?? atual.telefone
    });

    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.delete('/api/cotacoes/:id', auth, async (req, res) => {
  try {
    await run(`DELETE FROM cotacoes WHERE id = ?`, [req.params.id]);
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.get('/api/visitas', auth, async (req, res) => {
  try {
    let query = `SELECT * FROM visitas`;
    const params = [];
    if (req.usuario.tipo !== 'master') {
      query += ` WHERE vendedorId = ?`;
      params.push(req.usuario.id);
    }
    query += ` ORDER BY dataCriacao DESC`;
    res.json(await all(query, params));
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.post('/api/visitas', auth, async (req, res) => {
  try {
    const id = req.body.id || `VIS-${Date.now()}${Math.round(Math.random() * 1000)}`;
    const data = hojeISO();
    await run(`
      INSERT INTO visitas (
        id, cotacaoId, vendedorId, empresa, endereco, contato, telefone,
        status, dataVisita, tecnico, observacoes, dataCriacao, statusAtualizadoEm
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      req.body.cotacaoId || null,
      req.body.vendedorId || req.usuario.id,
      req.body.empresa || '',
      req.body.endereco || '',
      req.body.contato || '',
      req.body.telefone || '',
      req.body.status || 'Agendar Mapeamento',
      req.body.dataVisita || '',
      req.body.tecnico || '',
      req.body.observacoes || '',
      data,
      data
    ]);
    res.json({ sucesso: true, id });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.put('/api/visitas/:id', auth, async (req, res) => {
  try {
    const atual = await get(`SELECT * FROM visitas WHERE id = ?`, [req.params.id]);
    if (!atual) return res.status(404).json({ sucesso: false, erro: 'Visita não encontrada' });
    const novoStatus = req.body.status ?? atual.status;
    const statusAtualizadoEm = novoStatus !== atual.status ? hojeISO() : (atual.statusAtualizadoEm || hojeISO());

    await run(`
      UPDATE visitas
      SET empresa = ?, endereco = ?, contato = ?, telefone = ?, status = ?, dataVisita = ?, tecnico = ?, observacoes = ?, statusAtualizadoEm = ?
      WHERE id = ?
    `, [
      req.body.empresa ?? atual.empresa,
      req.body.endereco ?? atual.endereco,
      req.body.contato ?? atual.contato,
      req.body.telefone ?? atual.telefone,
      novoStatus,
      req.body.dataVisita ?? atual.dataVisita,
      req.body.tecnico ?? atual.tecnico,
      req.body.observacoes ?? atual.observacoes,
      statusAtualizadoEm,
      req.params.id
    ]);
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.delete('/api/visitas/:id', auth, async (req, res) => {
  try {
    await run(`DELETE FROM visitas WHERE id = ?`, [req.params.id]);
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.get('/api/arquivados', auth, async (req, res) => {
  try {
    let query = `SELECT * FROM arquivados`;
    const params = [];
    if (req.usuario.tipo !== 'master') {
      query += ` WHERE vendedorId = ?`;
      params.push(req.usuario.id);
    }
    query += ` ORDER BY dataArquivamento DESC`;
    res.json(await all(query, params));
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.post('/api/arquivar', auth, async (req, res) => {
  try {
    const ok = await arquivarRegistro(req.body.tipo, req.body.id, req.body.subtipo || 'manual', req.body.motivo || '', req.usuario.id);
    if (!ok) return res.status(404).json({ sucesso: false, erro: 'Registro não encontrado' });
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.post('/api/arquivados/:id/restaurar', auth, async (req, res) => {
  try {
    const item = await get(`SELECT * FROM arquivados WHERE id = ?`, [req.params.id]);
    if (!item) return res.status(404).json({ sucesso: false, erro: 'Arquivado não encontrado' });
    const dados = JSON.parse(item.dados);

    if (item.tipo === 'cotacao') {
      await run(`
        INSERT INTO cotacoes (
          id, vendedorId, cnpj, empresa, contato, email, telefone, descricao, material,
          quantidade, prazo, infoAdicional, status, dataCriacao, statusAtualizadoEm,
          dataAprovacao, observacoes, arquivos, linkOrcamento, valor
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        dados.id,
        dados.vendedorId || req.usuario.id,
        normalizeCnpj(dados.cnpj),
        dados.empresa || '',
        dados.contato || '',
        dados.email || '',
        dados.telefone || '',
        dados.descricao || '',
        dados.material || '',
        dados.quantidade || '',
        dados.prazo || '',
        dados.infoAdicional || '',
        dados.status || 'Novo Orçamento',
        dados.dataCriacao || hojeISO(),
        hojeISO(),
        dados.dataAprovacao || null,
        dados.observacoes || '',
        JSON.stringify(dados.arquivos || []),
        dados.linkOrcamento || '',
        Number(dados.valor || 0)
      ]);
    } else if (item.tipo === 'visita') {
      await run(`
        INSERT INTO visitas (
          id, cotacaoId, vendedorId, empresa, endereco, contato, telefone, status,
          dataVisita, tecnico, observacoes, dataCriacao, statusAtualizadoEm
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        dados.id,
        dados.cotacaoId || null,
        dados.vendedorId || req.usuario.id,
        dados.empresa || '',
        dados.endereco || '',
        dados.contato || '',
        dados.telefone || '',
        dados.status || 'Agendar Mapeamento',
        dados.dataVisita || '',
        dados.tecnico || '',
        dados.observacoes || '',
        dados.dataCriacao || hojeISO(),
        hojeISO()
      ]);
    }

    await run(`DELETE FROM arquivados WHERE id = ?`, [req.params.id]);
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.delete('/api/arquivados/:id', auth, async (req, res) => {
  try {
    await run(`DELETE FROM arquivados WHERE id = ?`, [req.params.id]);
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.get('/api/relatorios/geral', auth, masterOnly, async (_, res) => {
  try {
    const ativos = await all(`SELECT * FROM cotacoes`);
    const arquivados = await all(`SELECT * FROM arquivados WHERE tipo = 'cotacao'`);
    const todos = [
      ...ativos.map(c => ({ ...c, arquivos: c.arquivos ? JSON.parse(c.arquivos) : [] })),
      ...arquivados.map(a => JSON.parse(a.dados))
    ];

    const hoje = new Date();
    const inicioSemana = new Date(hoje);
    const day = inicioSemana.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    inicioSemana.setDate(inicioSemana.getDate() + offset);
    inicioSemana.setHours(0, 0, 0, 0);
    const fimSemana = new Date(inicioSemana);
    fimSemana.setDate(fimSemana.getDate() + 5);
    fimSemana.setHours(23, 59, 59, 999);

    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1, 0, 0, 0, 0);
    const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59, 999);

    const aprovados = todos.filter(c => c.status === 'Pedido Aprovado');
    const vendasSemana = aprovados
      .filter(c => {
        const d = new Date(c.dataAprovacao || c.dataCriacao || hojeISO());
        return d >= inicioSemana && d <= fimSemana;
      })
      .reduce((s, c) => s + Number(c.valor || 0), 0);

    const vendasMes = aprovados
      .filter(c => {
        const d = new Date(c.dataAprovacao || c.dataCriacao || hojeISO());
        return d >= inicioMes && d <= fimMes;
      })
      .reduce((s, c) => s + Number(c.valor || 0), 0);

    const vendedores = await all(`SELECT id, nome FROM vendedores WHERE ativo = 1 ORDER BY nome`);
    const porVendedor = vendedores.map(v => {
      const lista = todos.filter(item => item.vendedorId === v.id);
      const total = lista.length;
      const convertidos = lista.filter(item => item.status === 'Pedido Aprovado').length;
      const valorVendido = lista.filter(item => item.status === 'Pedido Aprovado').reduce((s, item) => s + Number(item.valor || 0), 0);
      return {
        vendedor: v.nome,
        total,
        convertidos,
        taxa: total ? `${((convertidos / total) * 100).toFixed(1)}%` : '0%',
        valorVendido
      };
    });

    res.json({
      geral: {
        vendasSemana,
        vendasMes,
        periodoSemana: `${mascararPeriodoBR(inicioSemana)} a ${mascararPeriodoBR(fimSemana)}`,
        periodoMes: `${mascararPeriodoBR(inicioMes)} a ${mascararPeriodoBR(fimMes)}`
      },
      porVendedor
    });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.post('/api/upload', upload.array('arquivos', 10), (req, res) => {
  try {
    const arquivos = (req.files || []).map(file => ({
      filename: file.filename,
      originalname: file.originalname,
      size: file.size,
      url: `/uploads/${file.filename}`
    }));
    res.json({ sucesso: true, arquivos });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 http://localhost:${PORT}`);
});
