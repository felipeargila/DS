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

// ================= MIDDLEWARES =================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// ================= UPLOAD =================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ================= DATABASE =================
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('❌ Erro ao conectar ao banco:', err);
        process.exit(1);
    }

    console.log('✅ Banco conectado');
    criarTabelas();
});

// ================= HELPERS =================
function runAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function getAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function allAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// ================= TABELAS =================
function criarTabelas() {
    db.serialize(async () => {
        try {
            await runAsync(`
                CREATE TABLE IF NOT EXISTS vendedores (
                    id TEXT PRIMARY KEY,
                    nome TEXT,
                    login TEXT UNIQUE,
                    senha TEXT,
                    codigoAcesso TEXT UNIQUE,
                    tipo TEXT DEFAULT 'vendedor',
                    ativo INTEGER DEFAULT 1,
                    dataCriacao TEXT
                )
            `);

            await runAsync(`
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
                    dataAprovacao TEXT,
                    observacoes TEXT,
                    arquivos TEXT,
                    linkOrcamento TEXT,
                    valor REAL DEFAULT 0,
                    FOREIGN KEY(vendedorId) REFERENCES vendedores(id)
                )
            `);

            await runAsync(`
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
                    FOREIGN KEY(cotacaoId) REFERENCES cotacoes(id),
                    FOREIGN KEY(vendedorId) REFERENCES vendedores(id)
                )
            `);

            await runAsync(`
                CREATE TABLE IF NOT EXISTS arquivados (
                    id TEXT PRIMARY KEY,
                    tipo TEXT,
                    subtipo TEXT,
                    dados TEXT,
                    dataArquivamento TEXT,
                    motivo TEXT,
                    vendedorId TEXT,
                    FOREIGN KEY(vendedorId) REFERENCES vendedores(id)
                )
            `);

            await runAsync(`
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

            console.log('✅ Tabelas OK');

            const hash = bcrypt.hashSync('admin123', 10);
            const dataAtual = new Date().toISOString().split('T')[0];

            const master = await getAsync(
                `SELECT * FROM vendedores WHERE id = 'MASTER' OR tipo = 'master' LIMIT 1`
            );

            if (!master) {
                await runAsync(`
                    INSERT INTO vendedores
                    (id, nome, login, senha, codigoAcesso, tipo, ativo, dataCriacao)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    'MASTER',
                    'Administrador',
                    'admin',
                    hash,
                    'ADMIN',
                    'master',
                    1,
                    dataAtual
                ]);

                console.log('✅ Admin criado: admin / admin123');
            } else {
                await runAsync(`
                    UPDATE vendedores
                    SET nome = ?, login = ?, senha = ?, codigoAcesso = ?, tipo = ?, ativo = 1
                    WHERE id = ?
                `, [
                    'Administrador',
                    'admin',
                    hash,
                    'ADMIN',
                    'master',
                    'MASTER'
                ]);

                console.log('✅ Admin resetado: admin / admin123');
            }

            iniciarAutomacao();
        } catch (error) {
            console.error('❌ Erro ao criar estrutura do banco:', error);
            process.exit(1);
        }
    });
}

// ================= AUTOMAÇÃO =================
let automacaoIniciada = false;

function arquivarAutomaticamente(cotacao, subtipo) {
    const dataArquivamento = new Date().toISOString().split('T')[0];

    db.serialize(() => {
        db.run(
            `INSERT OR REPLACE INTO arquivados
             (id, tipo, subtipo, dados, dataArquivamento, motivo, vendedorId)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                cotacao.id,
                'cotacao',
                subtipo,
                JSON.stringify(cotacao),
                dataArquivamento,
                `Automático: ${subtipo}`,
                cotacao.vendedorId || null
            ],
            function (err) {
                if (err) {
                    console.error('❌ Erro ao arquivar automaticamente:', err.message);
                    return;
                }

                db.run(`DELETE FROM cotacoes WHERE id = ?`, [cotacao.id], (deleteErr) => {
                    if (deleteErr) {
                        console.error('❌ Erro ao remover cotação após arquivamento:', deleteErr.message);
                    }
                });
            }
        );
    });
}

function iniciarAutomacao() {
    if (automacaoIniciada) return;
    automacaoIniciada = true;

    setInterval(async () => {
        try {
            const hoje = new Date();
            const cotacoes = await allAsync(`SELECT * FROM cotacoes`);

            for (const c of cotacoes) {
                if (!c.dataCriacao) continue;

                const dias = Math.floor(
                    (hoje - new Date(c.dataCriacao)) / (1000 * 60 * 60 * 24)
                );

                if (c.status === 'Orçamento Enviado' && dias >= 7) {
                    await runAsync(
                        `UPDATE cotacoes SET status = ? WHERE id = ?`,
                        ['Sem Retorno', c.id]
                    );
                    continue;
                }

                if (c.status === 'Sem Retorno' && dias >= 14) {
                    arquivarAutomaticamente(c, 'sem_retorno');
                    continue;
                }

                if (c.status === 'Pedido Aprovado' && dias >= 7) {
                    arquivarAutomaticamente(c, 'aprovado');
                }
            }
        } catch (error) {
            console.error('❌ Erro na automação:', error.message);
        }
    }, 60 * 60 * 1000);
}

// ================= AUTH =================
function verificarToken(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ erro: 'Token não fornecido' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.usuario = decoded;
        next();
    } catch (erro) {
        return res.status(401).json({ erro: 'Token inválido' });
    }
}

function verificarMaster(req, res, next) {
    if (req.usuario.tipo !== 'master') {
        return res.status(403).json({ erro: 'Acesso negado' });
    }
    next();
}

// ================= ROTAS PÚBLICAS =================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ================= LOGIN =================
app.post('/api/login', async (req, res) => {
    const { usuario, senha } = req.body;

    try {
        const row = await getAsync(
            `SELECT * FROM vendedores WHERE login = ? AND ativo = 1`,
            [usuario]
        );

        if (!row) {
            return res.json({ sucesso: false, erro: 'Usuário não encontrado' });
        }

        if (!bcrypt.compareSync(senha, row.senha)) {
            return res.json({ sucesso: false, erro: 'Senha incorreta' });
        }

        const token = jwt.sign(
            { id: row.id, nome: row.nome, tipo: row.tipo },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            sucesso: true,
            token,
            usuario: {
                id: row.id,
                nome: row.nome,
                tipo: row.tipo,
                codigoAcesso: row.codigoAcesso
            }
        });
    } catch (error) {
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

app.get('/api/verificar-token', verificarToken, (req, res) => {
    res.json({ sucesso: true, usuario: req.usuario });
});

// ================= VENDEDORES =================
app.get('/api/vendedores/codigo/:codigo', async (req, res) => {
    try {
        const row = await getAsync(
            `SELECT id, nome, codigoAcesso
             FROM vendedores
             WHERE codigoAcesso = ? AND ativo = 1`,
            [req.params.codigo]
        );

        if (row) {
            res.json({ sucesso: true, vendedor: row });
        } else {
            res.json({ sucesso: false, vendedor: null });
        }
    } catch (error) {
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

app.get('/api/vendedores', verificarToken, verificarMaster, async (req, res) => {
    try {
        const rows = await allAsync(
            `SELECT id, nome, login, codigoAcesso, tipo, ativo, dataCriacao
             FROM vendedores
             ORDER BY nome`
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// ================= CLIENTES =================
app.get('/api/clientes/:cnpj', async (req, res) => {
    try {
        const cnpj = req.params.cnpj.replace(/\D/g, '');

        const row = await getAsync(`
            SELECT cnpj, empresa, contato, email, telefone
            FROM cotacoes
            WHERE cnpj = ?
            ORDER BY dataCriacao DESC
            LIMIT 1
        `, [cnpj]);

        if (row) {
            res.json({ encontrado: true, cliente: row });
        } else {
            res.json({ encontrado: false });
        }
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// ================= COTAÇÕES =================
app.get('/api/cotacoes', verificarToken, async (req, res) => {
    try {
        let query = 'SELECT * FROM cotacoes';
        const params = [];

        if (req.usuario.tipo !== 'master') {
            query += ' WHERE vendedorId = ?';
            params.push(req.usuario.id);
        }

        query += ' ORDER BY dataCriacao DESC';

        const rows = await allAsync(query, params);

        const cotacoes = rows.map(row => ({
            ...row,
            arquivos: row.arquivos ? JSON.parse(row.arquivos) : []
        }));

        res.json(cotacoes);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/cotacoes', async (req, res) => {
    try {
        const {
            id, vendedorId, cnpj, empresa, contato, email, telefone, descricao,
            material, quantidade, prazo, infoAdicional, status, dataCriacao, arquivos, valor
        } = req.body;

        const arquivosJson = JSON.stringify(arquivos || []);

        await runAsync(`
            INSERT INTO cotacoes (
                id, vendedorId, cnpj, empresa, contato, email, telefone, descricao,
                material, quantidade, prazo, infoAdicional, status, dataCriacao, arquivos, valor
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id, vendedorId, cnpj, empresa, contato, email, telefone, descricao,
            material, quantidade, prazo, infoAdicional, status, dataCriacao, arquivosJson, valor || 0
        ]);

        res.json({ sucesso: true, id });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.put('/api/cotacoes/:id', verificarToken, async (req, res) => {
    try {
        const {
            empresa, contato, email, telefone, descricao, material,
            quantidade, prazo, infoAdicional, status, observacoes,
            linkOrcamento, valor, dataAprovacao
        } = req.body;

        await runAsync(`
            UPDATE cotacoes
            SET empresa = ?, contato = ?, email = ?, telefone = ?,
                descricao = ?, material = ?, quantidade = ?, prazo = ?,
                infoAdicional = ?, status = ?, observacoes = ?,
                linkOrcamento = ?, valor = ?, dataAprovacao = ?
            WHERE id = ?
        `, [
            empresa, contato, email, telefone, descricao, material,
            quantidade, prazo, infoAdicional, status, observacoes,
            linkOrcamento || null, valor || 0, dataAprovacao || null, req.params.id
        ]);

        res.json({ sucesso: true });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// ================= ARQUIVADOS =================
app.get('/api/arquivados', verificarToken, async (req, res) => {
    try {
        let query = 'SELECT * FROM arquivados';
        const params = [];

        if (req.usuario.tipo !== 'master') {
            query += ' WHERE vendedorId = ?';
            params.push(req.usuario.id);
        }

        const rows = await allAsync(query, params);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/arquivar', verificarToken, async (req, res) => {
    try {
        const { id, tipo, subtipo, dados, motivo } = req.body;
        const dataArquivamento = new Date().toISOString().split('T')[0];
        const dadosJson = JSON.stringify(dados);

        await runAsync(`
            INSERT INTO arquivados
            (id, tipo, subtipo, dados, dataArquivamento, motivo, vendedorId)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            id,
            tipo,
            subtipo || 'manual',
            dadosJson,
            dataArquivamento,
            motivo || '',
            req.usuario.id
        ]);

        if (tipo === 'cotacao') {
            await runAsync(`DELETE FROM cotacoes WHERE id = ?`, [id]);
        } else {
            await runAsync(`DELETE FROM visitas WHERE id = ?`, [id]);
        }

        res.json({ sucesso: true });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post('/api/arquivados/:id/restaurar', verificarToken, async (req, res) => {
    try {
        const row = await getAsync(`SELECT * FROM arquivados WHERE id = ?`, [req.params.id]);

        if (!row) {
            return res.status(404).json({ erro: 'Arquivado não encontrado' });
        }

        const dados = JSON.parse(row.dados);

        if (row.tipo === 'cotacao') {
            await runAsync(`
                INSERT INTO cotacoes (
                    id, vendedorId, cnpj, empresa, contato, email, telefone, descricao,
                    material, quantidade, prazo, infoAdicional, status, dataCriacao,
                    dataAprovacao, observacoes, arquivos, linkOrcamento, valor
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                dados.id,
                dados.vendedorId || req.usuario.id,
                dados.cnpj || '',
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
                dados.dataCriacao || new Date().toISOString().split('T')[0],
                dados.dataAprovacao || null,
                dados.observacoes || '',
                JSON.stringify(dados.arquivos || []),
                dados.linkOrcamento || null,
                dados.valor || 0
            ]);
        }

        await runAsync(`DELETE FROM arquivados WHERE id = ?`, [req.params.id]);

        res.json({ sucesso: true });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.delete('/api/arquivados/:id', verificarToken, async (req, res) => {
    try {
        await runAsync(`DELETE FROM arquivados WHERE id = ?`, [req.params.id]);
        res.json({ sucesso: true });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// ================= RELATÓRIOS =================
app.get('/api/relatorios/geral', verificarToken, verificarMaster, async (req, res) => {
    try {
        const hoje = new Date();

        const ativos = await allAsync(`SELECT * FROM cotacoes`);
        const arquivados = await allAsync(`SELECT * FROM arquivados WHERE tipo = 'cotacao'`);

        const cotacoesArquivadas = arquivados
            .map(a => {
                try {
                    return JSON.parse(a.dados);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);

        const todas = [...ativos, ...cotacoesArquivadas];

        const inicioSemana = new Date(hoje);
        const dia = inicioSemana.getDay();
        const diffParaSegunda = dia === 0 ? 6 : dia - 1;
        inicioSemana.setDate(hoje.getDate() - diffParaSegunda);
        inicioSemana.setHours(0, 0, 0, 0);

        const fimSemana = new Date(inicioSemana);
        fimSemana.setDate(inicioSemana.getDate() + 5);
        fimSemana.setHours(23, 59, 59, 999);

        const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1, 0, 0, 0, 0);
        const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59, 999);

        const ehAprovado = c => c.status === 'Pedido Aprovado';

        const dentro = (data, inicio, fim) => {
            if (!data) return false;
            const d = new Date(data);
            return d >= inicio && d <= fim;
        };

        const vendasSemana = todas
            .filter(c => ehAprovado(c) && dentro(c.dataAprovacao || c.dataCriacao, inicioSemana, fimSemana))
            .reduce((s, c) => s + Number(c.valor || 0), 0);

        const vendasMes = todas
            .filter(c => ehAprovado(c) && dentro(c.dataAprovacao || c.dataCriacao, inicioMes, fimMes))
            .reduce((s, c) => s + Number(c.valor || 0), 0);

        const vendedores = await allAsync(`SELECT id, nome FROM vendedores WHERE ativo = 1 ORDER BY nome`);

        const porVendedor = vendedores.map(v => {
            const itens = todas.filter(c => c.vendedorId === v.id);
            const total = itens.length;
            const convertidos = itens.filter(ehAprovado).length;
            const valorVendido = itens
                .filter(ehAprovado)
                .reduce((s, c) => s + Number(c.valor || 0), 0);

            return {
                vendedor: v.nome,
                total,
                convertidos,
                taxa: total > 0 ? ((convertidos / total) * 100).toFixed(1) + '%' : '0%',
                valorVendido
            };
        });

        const formatarDataBR = d => d.toLocaleDateString('pt-BR');

        res.json({
            geral: {
                vendasSemana,
                vendasMes,
                periodoSemana: `${formatarDataBR(inicioSemana)} a ${formatarDataBR(fimSemana)}`,
                periodoMes: `${formatarDataBR(inicioMes)} a ${formatarDataBR(fimMes)}`
            },
            porVendedor
        });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// ================= UPLOAD =================
app.post('/api/upload', upload.array('arquivos', 10), (req, res) => {
    try {
        const files = (req.files || []).map(file => ({
            filename: file.filename,
            originalname: file.originalname,
            path: file.path,
            size: file.size,
            url: `/uploads/${file.filename}`
        }));

        res.json({ sucesso: true, arquivos: files });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// ================= START =================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 http://localhost:${PORT}`);
});
