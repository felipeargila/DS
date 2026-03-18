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
app.get('/forcar-reset-admin', (req, res) => {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('admin123', salt);

    db.run(`
        UPDATE vendedores 
        SET senha = ?, login = 'admin', codigoAcesso = 'ADMIN', tipo = 'master', ativo = 1
        WHERE tipo = 'master'
    `, [hash], function(err) {
        if (err) {
            res.send('Erro: ' + err.message);
        } else {
            res.send('Admin resetado: admin / admin123');
        }
    });
});

// ================= UPLOAD =================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + ext);
    }
});

const upload = multer({ storage });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ================= DATABASE =================
const db = new sqlite3.Database('./database.db');

// ================= AUTOMAÇÃO =================
function rodarAutomacao() {
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
}

setInterval(rodarAutomacao, 1000 * 60 * 60); // 1h

// ================= ARQUIVAR =================
function arquivar(item, subtipo) {
    const data = new Date().toISOString().split('T')[0];

    db.run(
        `INSERT INTO arquivados (id, tipo, subtipo, dados, dataArquivamento)
         VALUES (?, ?, ?, ?, ?)`,
        [
            item.id,
            'cotacao',
            subtipo,
            JSON.stringify(item),
            data
        ]
    );

    db.run(`DELETE FROM cotacoes WHERE id=?`, [item.id]);
}

// ================= RESTAURAR =================
app.post('/api/arquivados/:id/restaurar', (req, res) => {
    const id = req.params.id;

    db.get(`SELECT * FROM arquivados WHERE id=?`, [id], (err, row) => {
        if (!row) return res.json({ erro: 'Não encontrado' });

        const dados = JSON.parse(row.dados);

        db.run(
            `INSERT INTO cotacoes 
            (id, vendedorId, cnpj, empresa, contato, email, telefone, descricao, status, dataCriacao, valor, linkOrcamento)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                dados.id,
                dados.vendedorId,
                dados.cnpj,
                dados.empresa,
                dados.contato,
                dados.email,
                dados.telefone,
                dados.descricao,
                dados.status,
                dados.dataCriacao,
                dados.valor,
                dados.linkOrcamento
            ]
        );

        db.run(`DELETE FROM arquivados WHERE id=?`, [id]);

        res.json({ sucesso: true });
    });
});

// ================= RELATÓRIOS =================
app.get('/api/relatorios/geral', (req, res) => {

    db.all(`SELECT * FROM cotacoes`, [], (err, ativos) => {
        db.all(`SELECT * FROM arquivados WHERE tipo='cotacao'`, [], (err, arquivados) => {

            const todos = [
                ...ativos,
                ...arquivados.map(a => JSON.parse(a.dados))
            ];

            const hoje = new Date();

            const semana = todos.filter(c => {
                const d = new Date(c.dataCriacao);
                return (hoje - d) <= 7 * 86400000;
            });

            const mes = todos.filter(c => {
                const d = new Date(c.dataCriacao);
                return d.getMonth() === hoje.getMonth();
            });

            function somar(lista) {
                return lista.reduce((acc, c) => acc + (c.valor || 0), 0);
            }

            res.json({
                semana: somar(semana),
                mes: somar(mes),
                total: somar(todos)
            });
        });
    });
});

// ================= ROTAS =================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ================= COTAÇÕES =================
app.get('/api/cotacoes', (req, res) => {
    db.all(`SELECT * FROM cotacoes ORDER BY dataCriacao DESC`, [], (err, rows) => {
        res.json(rows);
    });
});

app.post('/api/cotacoes', (req, res) => {
    const c = req.body;

    db.run(
        `INSERT INTO cotacoes 
        (id, vendedorId, cnpj, empresa, contato, email, telefone, descricao, status, dataCriacao, valor, linkOrcamento)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
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
            c.valor || 0,
            c.linkOrcamento || ''
        ]
    );

    res.json({ sucesso: true });
});

app.put('/api/cotacoes/:id', (req, res) => {
    const c = req.body;

    db.run(
        `UPDATE cotacoes SET 
        status=?, valor=?, linkOrcamento=? 
        WHERE id=?`,
        [c.status, c.valor, c.linkOrcamento, req.params.id]
    );

    res.json({ sucesso: true });
});

// ================= ARQUIVADOS =================
app.get('/api/arquivados', (req, res) => {
    db.all(`SELECT * FROM arquivados`, [], (err, rows) => {
        res.json(rows);
    });
});

// ================= UPLOAD =================
app.post('/api/upload', upload.array('arquivos'), (req, res) => {
    const arquivos = req.files.map(f => ({
        url: '/uploads/' + f.filename
    }));
    res.json({ arquivos });
});

// ================= START =================
app.listen(PORT, () => {
    console.log(`🚀 Rodando em http://localhost:${PORT}`);
});
