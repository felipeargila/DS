// Adicionar no início do arquivo (com as outras importações)
const nodemailer = require('nodemailer');
const fs = require('fs').promises;

// Configuração do email (adicionar depois das constantes)
const transporter = nodemailer.createTransport({
    host: 'smtp.seudominio.com.br', // Configurar com os dados da HostGator
    port: 587,
    secure: false,
    auth: {
        user: 'osds@dsindustria.com.br',
        pass: 'SUA_SENHA_AQUI'
    }
});

// ========== ROTA DE CLIENTES ==========
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

// ========== FUNÇÃO DE ENVIO DE EMAIL ==========
async function enviarEmailCotacao(dados, arquivos) {
    const mailOptions = {
        from: '"Sistema de Cotações" <osds@dsindustria.com.br>',
        to: 'osds@dsindustria.com.br',
        subject: `Nova Cotação - ${dados.empresa}`,
        html: `
            <h2>Nova Solicitação de Orçamento</h2>
            <p><strong>Empresa:</strong> ${dados.empresa}</p>
            <p><strong>CNPJ:</strong> ${dados.cnpj}</p>
            <p><strong>Contato:</strong> ${dados.contato}</p>
            <p><strong>E-mail:</strong> ${dados.email}</p>
            <p><strong>Telefone:</strong> ${dados.telefone}</p>
            <p><strong>Descrição:</strong> ${dados.descricao}</p>
            <p><strong>Material:</strong> ${dados.material || 'Não especificado'}</p>
            <p><strong>Quantidade:</strong> ${dados.quantidade || 'Não especificada'}</p>
            <p><strong>Prazo:</strong> ${dados.prazo || 'Não especificado'}</p>
            <p><strong>Informações Adicionais:</strong> ${dados.infoAdicional || 'Nenhuma'}</p>
            <p><strong>Data:</strong> ${dados.dataCriacao}</p>
            <p><strong>ID da Cotação:</strong> ${dados.id}</p>
            ${dados.primeiroAcesso ? '<p><strong>⭐ Primeiro acesso do cliente!</strong></p>' : ''}
        `,
        attachments: arquivos.map(arq => ({
            filename: arq.originalname,
            path: arq.path
        }))
    };
    
    try {
        await transporter.sendMail(mailOptions);
        console.log('Email enviado com sucesso');
    } catch (erro) {
        console.error('Erro ao enviar email:', erro);
    }
}

// Modificar a rota POST /api/cotacoes para incluir email
app.post('/api/cotacoes', async (req, res) => {
    const { id, vendedorId, cnpj, empresa, contato, email, telefone, descricao, material, 
            quantidade, prazo, infoAdicional, status, dataCriacao, arquivos, primeiroAcesso } = req.body;
    
    const arquivosJson = JSON.stringify(arquivos || []);
    
    db.run(
        `INSERT INTO cotacoes (id, vendedorId, cnpj, empresa, contato, email, telefone, descricao, 
         material, quantidade, prazo, infoAdicional, status, dataCriacao, arquivos) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, vendedorId, cnpj, empresa, contato, email, telefone, descricao, material, 
         quantidade, prazo, infoAdicional, status, dataCriacao, arquivosJson],
        async function(err) {
            if (err) {
                res.status(500).json({ erro: err.message });
            } else {
                // Enviar email em background (não precisa aguardar)
                enviarEmailCotacao(req.body, arquivos || []).catch(console.error);
                
                res.json({ sucesso: true, id: id });
            }
        }
    );
});