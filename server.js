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

// ================= MIDDLEWARES =================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// ================= UPLOAD =================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ================= DATABASE =================
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error(err);
    } else {
        console.log('✅ Banco conectado');
        criarTabelas();
    }
});

// ================= TABELAS =================
function criarTabelas() {

    db.run(`
        CREATE TABLE IF NOT EXISTS vendedores (
            id TEXT PRIMARY KEY,
            nome TEXT,
            login TEXT UNIQUE,
            senha TEXT,
            codigoAcesso TEXT,
            tipo TEXT,
            ativo INTEGER,
            dataCriacao TEXT
        )
    `);

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
            status TEXT,
            dataCriacao TEXT,
            linkOrcamento TEXT,
            valor REAL
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS arquivados (
            id TEXT PRIMARY KEY,
            tipo TEXT,
            subtipo TEXT,
            dados TEXT,
            dataArquivamento TEXT
        )
    `);

    console.log('✅ Tabelas OK');

    // ===== GARANTE ADMIN =====
    const hash = bcrypt.hashSync('admin123', 10);

    db.run(`
        INSERT INTO vendedores (id, nome, login, senha, codigoAcesso, tipo, ativo, dataCriacao)
        VALUES ('MASTER', 'Administrador', 'admin', ?, 'ADMIN', 'master', 1, date('now'))
        ON CONFLICT(id) DO UPDATE SET
            senha=excluded.senha,
            login='admin'
    `, [hash]);

    console.log('✅ Admin garantido: admin / admin123');
}

// ================= AUTOMAÇÃO =================
setInterval(() => {
    const hoje = new Date();

    db.all(`SELECT * FROM cotacoes`, [], (err, rows) => {
        rows.forEach(c => {

            const dias = Math.floor(
                (hoje - new Date(c.dataCriacao)) / (1000 * 60 * 60 * 24)
            );

            if (c.status === 'Orçamento Enviado' && dias >= 7) {
                db.run(`UPDATE cotacoes SET status='Sem Retorno' WHERE id=?`, [c.id]);
            }

            if (c.status === 'Sem Retorno' && dias >= 14) {
                arquivar(c, 'sem_retorno');
            }

            if (c.status === 'Pedido Aprovado' && dias >= 7) {
                arquivar(c, 'aprovado');
            }

        });
    });

}, 1000 * 60 * 60);

// ================= ARQUIVAR =================
function arquivar(c, subtipo) {
    db.run(`
        INSERT INTO arquivados (id, tipo, subtipo, dados, dataArquivamento)
        VALUES (?, 'cotacao', ?, ?, date('now'))
    `, [c.id, subtipo, JSON.stringify(c)]);

    db.run(`DELETE FROM cotacoes WHERE id=?`, [c.id]);
}

// ================= RESTAURAR =================
app.post('/api/arquivados/:id/restaurar', (req, res) => {
    db.get(`SELECT * FROM arquivados WHERE id=?`, [req.params.id], (err, row) => {

        if (!row) return res.json({ erro: 'não encontrado' });

        const c = JSON.parse(row.dados);

        db.run(`
            INSERT INTO cotacoes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            c.id,
            c.vendedorId,
            c.cnpj,
            c.empresa,
            c.contato,
            c.email,
            c.telefone,
            c.descricao,
            c.status,
            c.dataCriacao,
            c.linkOrcamento,
            c.valor
        ]);

        db.run(`DELETE FROM arquivados WHERE id=?`, [req.params.id]);

        res.json({ ok: true });
    });
});

// ================= RELATÓRIOS =================
app.get('/api/relatorios', (req, res) => {

    db.all(`SELECT * FROM cotacoes`, [], (err, ativos) => {

        db.all(`SELECT * FROM arquivados`, [], (err, arquivados) => {

            const lista = [
                ...ativos,
                ...arquivados.map(a => JSON.parse(a.dados))
            ];

            const hoje = new Date();

            const semana = lista.filter(c => {
                return (hoje - new Date(c.dataCriacao)) <= 7 * 86400000;
            });

            const mes = lista.filter(c => {
                return new Date(c.dataCriacao).getMonth() === hoje.getMonth();
            });

            const soma = arr => arr.reduce((s, c) => s + (c.valor || 0), 0);

            res.json({
                semana: soma(semana),
                mes: soma(mes),
                total: soma(lista)
            });

        });

    });

});

// ================= COTAÇÕES =================
app.get('/api/cotacoes', (req, res) => {
    db.all(`SELECT * FROM cotacoes ORDER BY dataCriacao DESC`, [], (err, rows) => {
        res.json(rows);
    });
});

app.post('/api/cotacoes', (req, res) => {

    const c = req.body;

    db.run(`
        INSERT INTO cotacoes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        c.id,
        c.vendedorId,
        c.cnpj,
        c.empresa,
        c.contato,
        c.email,
        c.telefone,
        c.descricao,
        c.status,
        c.dataCriacao,
        c.linkOrcamento || '',
        c.valor || 0
    ]);

    res.json({ ok: true });
});

app.put('/api/cotacoes/:id', (req, res) => {

    const c = req.body;

    db.run(`
        UPDATE cotacoes 
        SET status=?, linkOrcamento=?, valor=?
        WHERE id=?
    `, [c.status, c.linkOrcamento, c.valor, req.params.id]);

    res.json({ ok: true });
});

// ================= ARQUIVADOS =================
app.get('/api/arquivados', (req, res) => {
    db.all(`SELECT * FROM arquivados`, [], (err, rows) => {
        res.json(rows);
    });
});

// ================= UPLOAD =================
app.post('/api/upload', upload.array('arquivos'), (req, res) => {
    res.json({
        arquivos: req.files.map(f => ({
            url: '/uploads/' + f.filename
        }))
    });
});

// ================= ROTAS =================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ================= START =================
app.listen(PORT, () => {
    console.log(`🚀 http://localhost:${PORT}`);
});
