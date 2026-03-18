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

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// Configuração do multer para uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.pdf', '.dwg', '.dxf', '.step', '.stp', '.jpg', '.jpeg', '.png'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de arquivo não permitido'));
        }
    }
});

// Servir arquivos estáticos da pasta uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Conectar ao banco de dados SQLite
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('❌ Erro ao conectar ao banco:', err);
    } else {
        console.log('✅ Banco de dados conectado!');
        criarTabelas();
    }
});

// Criar todas as tabelas necessárias
function criarTabelas() {
    // Tabela de vendedores/usuários
    db.run(`
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

    // Tabela de cotações (com campos para aprovação)
    db.run(`
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

    // Tabela de visitas técnicas
    db.run(`
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

    // Tabela de arquivados (com subtipo)
    db.run(`
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

    console.log('✅ Tabelas criadas/verificadas!');

    // Criar vendedor master padrão (se não existir)
    db.get("SELECT * FROM vendedores WHERE tipo = 'master'", [], (err, row) => {
        if (!row) {
            const salt = bcrypt.genSaltSync(10);
            const hash = bcrypt.hashSync('admin123', salt);
            const dataAtual = new Date().toISOString().split('T')[0];
            
            db.run(
                `INSERT INTO vendedores (id, nome, login, senha, codigoAcesso, tipo, dataCriacao) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ['MASTER', 'Administrador', 'admin', hash, 'ADMIN', 'master', dataAtual],
                function(err) {
                    if (!err) {
                        console.log('✅ Usuário master criado (login: admin, senha: admin123, código: ADMIN)');
                    }
                }
            );
        }
    });
}

// ========== MIDDLEWARE DE AUTENTICAÇÃO ==========
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
        return res.status(403).json({ erro: 'Acesso negado - necessário privilégios de master' });
    }
    next();
}

// ========== ROTAS PÚBLICAS ==========
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ========== ROTAS DE AUTENTICAÇÃO ==========
app.post('/api/login', (req, res) => {
    const { usuario, senha } = req.body;
    
    db.get('SELECT * FROM vendedores WHERE login = ? AND ativo = 1', [usuario], (err, row) => {
        if (err) {
            res.status(500).json({ sucesso: false, erro: err.message });
        } else if (!row) {
            res.json({ sucesso: false, erro: 'Usuário não encontrado' });
        } else {
            if (bcrypt.compareSync(senha, row.senha)) {
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
            } else {
                res.json({ sucesso: false, erro: 'Senha incorreta' });
            }
        }
    });
});

app.get('/api/verificar-token', verificarToken, (req, res) => {
    res.json({ sucesso: true, usuario: req.usuario });
});

// ========== ROTAS DE VENDEDORES ==========
app.get('/api/vendedores/codigo/:codigo', (req, res) => {
    db.get('SELECT id, nome, codigoAcesso FROM vendedores WHERE codigoAcesso = ? AND ativo = 1', 
        [req.params.codigo], 
        (err, row) => {
            if (err) {
                res.status(500).json({ sucesso: false, erro: err.message });
            } else if (row) {
                res.json({ sucesso: true, vendedor: row });
            } else {
                res.json({ sucesso: false, vendedor: null });
            }
        }
    );
});

app.get('/api/vendedores', verificarToken, verificarMaster, (req, res) => {
    db.all('SELECT id, nome, login, codigoAcesso, tipo, ativo, dataCriacao FROM vendedores ORDER BY nome', [], (err, rows) => {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else {
            res.json(rows);
        }
    });
});

app.post('/api/vendedores', verificarToken, verificarMaster, (req, res) => {
    const { id, nome, login, senha, codigoAcesso, tipo } = req.body;
    
    if (!codigoAcesso || codigoAcesso.length !== 6) {
        return res.status(400).json({ erro: 'Código de acesso deve ter exatamente 6 caracteres' });
    }
    
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(senha, salt);
    const dataAtual = new Date().toISOString().split('T')[0];
    const codigoUpper = codigoAcesso.toUpperCase();
    
    db.run(
        `INSERT INTO vendedores (id, nome, login, senha, codigoAcesso, tipo, dataCriacao) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, nome, login, hash, codigoUpper, tipo || 'vendedor', dataAtual],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    res.status(400).json({ erro: 'Login ou código de acesso já existe' });
                } else {
                    res.status(500).json({ erro: err.message });
                }
            } else {
                res.json({ sucesso: true, id: id });
            }
        }
    );
});

app.put('/api/vendedores/:id', verificarToken, verificarMaster, (req, res) => {
    const { nome, login, codigoAcesso, tipo, ativo } = req.body;
    
    if (codigoAcesso && codigoAcesso.length !== 6) {
        return res.status(400).json({ erro: 'Código de acesso deve ter exatamente 6 caracteres' });
    }
    
    const codigoUpper = codigoAcesso ? codigoAcesso.toUpperCase() : null;
    
    db.run(
        `UPDATE vendedores SET nome = ?, login = ?, codigoAcesso = COALESCE(?, codigoAcesso), tipo = ?, ativo = ? WHERE id = ?`,
        [nome, login, codigoUpper, tipo, ativo, req.params.id],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    res.status(400).json({ erro: 'Login ou código de acesso já existe' });
                } else {
                    res.status(500).json({ erro: err.message });
                }
            } else {
                res.json({ sucesso: true });
            }
        }
    );
});

app.delete('/api/vendedores/:id', verificarToken, verificarMaster, (req, res) => {
    db.run('DELETE FROM vendedores WHERE id = ? AND tipo != "master"', [req.params.id], function(err) {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else {
            res.json({ sucesso: true });
        }
    });
});

// ========== ALTERAR SENHA ==========
app.put('/api/vendedores/:id/senha', verificarToken, (req, res) => {
    const { senha } = req.body;
    const vendedorId = req.params.id;
    
    if (req.usuario.tipo !== 'master' && req.usuario.id !== vendedorId) {
        return res.status(403).json({ erro: 'Acesso negado' });
    }
    
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(senha, salt);
    
    db.run('UPDATE vendedores SET senha = ? WHERE id = ?', [hash, vendedorId], function(err) {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else {
            res.json({ sucesso: true });
        }
    });
});

// ========== ROTAS DE UPLOAD ==========
app.post('/api/upload', upload.array('arquivos', 10), (req, res) => {
    try {
        const files = req.files.map(file => ({
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

app.delete('/api/upload/:filename', verificarToken, (req, res) => {
    const filepath = path.join(__dirname, 'uploads', req.params.filename);
    
    fs.unlink(filepath, (err) => {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else {
            res.json({ sucesso: true });
        }
    });
});

// ========== ROTAS DE CLIENTES ==========
app.get('/api/clientes/:cnpj', (req, res) => {
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    
    db.get(`
        SELECT cnpj, empresa, contato, email, telefone 
        FROM cotacoes 
        WHERE cnpj = ? 
        ORDER BY dataCriacao DESC 
        LIMIT 1
    `, [cnpj], (err, row) => {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else if (row) {
            res.json({ encontrado: true, cliente: row });
        } else {
            res.json({ encontrado: false });
        }
    });
});

app.put('/api/clientes/:cnpj/observacoes', verificarToken, (req, res) => {
    const { observacoes } = req.body;
    const cnpj = req.params.cnpj.replace(/\D/g, '');
    
    res.json({ sucesso: true });
});

// ========== ROTAS DE COTAÇÕES ==========
app.get('/api/cotacoes', verificarToken, (req, res) => {
    let query = 'SELECT * FROM cotacoes';
    let params = [];
    
    if (req.usuario.tipo !== 'master') {
        query += ' WHERE vendedorId = ?';
        params.push(req.usuario.id);
    }
    
    query += ' ORDER BY dataCriacao DESC';
    
    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else {
            const cotacoes = rows.map(row => ({
                ...row,
                arquivos: row.arquivos ? JSON.parse(row.arquivos) : []
            }));
            res.json(cotacoes);
        }
    });
});

app.post('/api/cotacoes', (req, res) => {
    const { id, vendedorId, cnpj, empresa, contato, email, telefone, descricao, material, 
            quantidade, prazo, infoAdicional, status, dataCriacao, arquivos, valor } = req.body;
    
    const arquivosJson = JSON.stringify(arquivos || []);
    
    db.run(
        `INSERT INTO cotacoes (id, vendedorId, cnpj, empresa, contato, email, telefone, descricao, 
         material, quantidade, prazo, infoAdicional, status, dataCriacao, arquivos, valor) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, vendedorId, cnpj, empresa, contato, email, telefone, descricao, material, 
         quantidade, prazo, infoAdicional, status, dataCriacao, arquivosJson, valor || 0],
        function(err) {
            if (err) {
                res.status(500).json({ erro: err.message });
            } else {
                res.json({ sucesso: true, id: id });
            }
        }
    );
});

app.put('/api/cotacoes/:id', verificarToken, (req, res) => {
    const { empresa, contato, email, telefone, descricao, material, 
            quantidade, prazo, infoAdicional, status, observacoes, 
            linkOrcamento, valor, dataAprovacao } = req.body;
    
    db.run(
        `UPDATE cotacoes SET empresa = ?, contato = ?, email = ?, telefone = ?, 
         descricao = ?, material = ?, quantidade = ?, prazo = ?, 
         infoAdicional = ?, status = ?, observacoes = ?, 
         linkOrcamento = ?, valor = ?, dataAprovacao = ? WHERE id = ?`,
        [empresa, contato, email, telefone, descricao, material, 
         quantidade, prazo, infoAdicional, status, observacoes,
         linkOrcamento, valor || 0, dataAprovacao, req.params.id],
        function(err) {
            if (err) {
                res.status(500).json({ erro: err.message });
            } else {
                res.json({ sucesso: true });
            }
        }
    );
});

app.delete('/api/cotacoes/:id', verificarToken, (req, res) => {
    db.run('DELETE FROM cotacoes WHERE id = ?', [req.params.id], function(err) {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else {
            res.json({ sucesso: true });
        }
    });
});

// ========== ROTAS DE VISITAS ==========
app.get('/api/visitas', verificarToken, (req, res) => {
    let query = 'SELECT * FROM visitas';
    let params = [];
    
    if (req.usuario.tipo !== 'master') {
        query += ' WHERE vendedorId = ?';
        params.push(req.usuario.id);
    }
    
    query += ' ORDER BY dataCriacao DESC';
    
    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else {
            res.json(rows);
        }
    });
});

app.post('/api/visitas', verificarToken, (req, res) => {
    const { id, cotacaoId, vendedorId, empresa, endereco, contato, telefone, status, 
            dataVisita, tecnico, observacoes, dataCriacao } = req.body;
    
    db.run(
        `INSERT INTO visitas (id, cotacaoId, vendedorId, empresa, endereco, contato, telefone, status,
         dataVisita, tecnico, observacoes, dataCriacao) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, cotacaoId, vendedorId || req.usuario.id, empresa, endereco, contato, telefone, status,
         dataVisita, tecnico, observacoes, dataCriacao],
        function(err) {
            if (err) {
                res.status(500).json({ erro: err.message });
            } else {
                res.json({ sucesso: true, id: id });
            }
        }
    );
});

app.put('/api/visitas/:id', verificarToken, (req, res) => {
    const { empresa, endereco, contato, telefone, status, 
            dataVisita, tecnico, observacoes } = req.body;
    
    db.run(
        `UPDATE visitas SET empresa = ?, endereco = ?, contato = ?, telefone = ?,
         status = ?, dataVisita = ?, tecnico = ?, observacoes = ? WHERE id = ?`,
        [empresa, endereco, contato, telefone, status, dataVisita, tecnico, observacoes, req.params.id],
        function(err) {
            if (err) {
                res.status(500).json({ erro: err.message });
            } else {
                res.json({ sucesso: true });
            }
        }
    );
});

app.delete('/api/visitas/:id', verificarToken, (req, res) => {
    db.run('DELETE FROM visitas WHERE id = ?', [req.params.id], function(err) {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else {
            res.json({ sucesso: true });
        }
    });
});

// ========== ROTAS DE ARQUIVADOS ==========
app.get('/api/arquivados', verificarToken, (req, res) => {
    let query = 'SELECT * FROM arquivados';
    let params = [];
    
    if (req.usuario.tipo !== 'master') {
        query += ' WHERE vendedorId = ?';
        params.push(req.usuario.id);
    }
    
    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else {
            res.json(rows);
        }
    });
});

app.post('/api/arquivar', verificarToken, (req, res) => {
    const { id, tipo, subtipo, dados, motivo } = req.body;
    const dataArquivamento = new Date().toISOString().split('T')[0];
    const dadosJson = JSON.stringify(dados);
    
    db.run(
        `INSERT INTO arquivados (id, tipo, subtipo, dados, dataArquivamento, motivo, vendedorId) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, tipo, subtipo || 'manual', dadosJson, dataArquivamento, motivo, req.usuario.id],
        function(err) {
            if (err) {
                res.status(500).json({ erro: err.message });
            } else {
                if (tipo === 'cotacao') {
                    db.run('DELETE FROM cotacoes WHERE id = ?', [id]);
                } else {
                    db.run('DELETE FROM visitas WHERE id = ?', [id]);
                }
                res.json({ sucesso: true });
            }
        }
    );
});

app.delete('/api/arquivados/:id', verificarToken, (req, res) => {
    db.run('DELETE FROM arquivados WHERE id = ?', [req.params.id], function(err) {
        if (err) {
            res.status(500).json({ erro: err.message });
        } else {
            res.json({ sucesso: true });
        }
    });
});

// ========== ROTAS DE RELATÓRIOS ==========
app.get('/api/relatorios/geral', verificarToken, verificarMaster, (req, res) => {
    const periodo = req.query.periodo || '30';
    
    db.all(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'Pedido Aprovado' THEN 1 ELSE 0 END) as convertidos,
            SUM(CASE WHEN status = 'Pedido Aprovado' THEN valor ELSE 0 END) as valorTotal
        FROM cotacoes 
        WHERE julianday('now') - julianday(dataCriacao) <= ?
    `, [periodo], (err, geral) => {
        if (err) {
            res.status(500).json({ erro: err.message });
            return;
        }
        
        db.all(`
            SELECT 
                v.nome as vendedor,
                COUNT(c.id) as total,
                SUM(CASE WHEN c.status = 'Pedido Aprovado' THEN 1 ELSE 0 END) as convertidos,
                SUM(CASE WHEN c.status = 'Pedido Aprovado' THEN c.valor ELSE 0 END) as valorVendido
            FROM vendedores v
            LEFT JOIN cotacoes c ON v.id = c.vendedorId AND julianday('now') - julianday(c.dataCriacao) <= ?
            GROUP BY v.id
        `, [periodo], (err, porVendedor) => {
            if (err) {
                res.status(500).json({ erro: err.message });
            } else {
                res.json({
                    geral: geral[0] || { total: 0, convertidos: 0, valorTotal: 0 },
                    porVendedor: porVendedor || []
                });
            }
        });
    });
});

// ========== INICIAR SERVIDOR ==========
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`📡 API disponível em http://localhost:${PORT}/api`);
    console.log(`📧 Serviço de email não configurado (adicione depois se necessário)`);
});