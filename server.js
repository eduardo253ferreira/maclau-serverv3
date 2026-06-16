require('dotenv').config();
process.env.TZ = 'Europe/Lisbon';
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const qrcode = require('qrcode');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const multer = require('multer');

// --- Configuração Multer (Upload de Fotos) ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/reports')
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
        cb(null, 'report-' + uniqueSuffix + path.extname(file.originalname))
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            console.warn(`[UPLOAD] Ficheiro rejeitado (Mimetype inválido): ${file.originalname} (${file.mimetype})`);
            cb(new Error('Apenas imagens (JPG, PNG, etc.) são permitidas!'));
        }
    }
});
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔒 SEGURANÇA: Confiar no proxy (necessário para HTTPS via proxy e Rate Limiting)
app.set('trust proxy', 1);

// 🔒 SEGURANÇA: Validar SECRET_KEY obrigatória e forte
const SECRET_KEY = process.env.SECRET_KEY;
if (!SECRET_KEY || SECRET_KEY.length < 32) {
    console.error('❌ ERRO FATAL: SECRET_KEY não definida ou muito fraca! Mínimo 32 caracteres.');
    console.error('   Gere uma chave forte: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    process.exit(1);
}

// 🔒 SEGURANÇA: Helper para sanitização de inputs
const sanitizeString = (str, maxLength = 255) => {
    if (typeof str !== 'string') return '';
    return str.trim().substring(0, maxLength);
};

// 🔒 SEGURANÇA: Validador de UUID
const isValidUUID = (uuid) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
};

// 🔒 SEGURANÇA: Logger de segurança
const securityLog = (event, details) => {
    const timestamp = new Date().toISOString();
    console.log(`[SECURITY] ${timestamp} - ${event}:`, JSON.stringify(details));
};

// Helmet com CSP mais restritivo
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "https://unpkg.com", "https://cdn.jsdelivr.net"],
            "script-src-attr": ["'self'"],
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://unpkg.com"],
            "font-src": ["'self'", "https://fonts.gstatic.com", "https://unpkg.com", "https://cdn.jsdelivr.net"],
            "img-src": ["'self'", "data:", "blob:"],
            "connect-src": ["'self'"],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// 🔒 CORREÇÃO: CORS sem IPs privados genéricos — usar apenas allowedOrigins do .env
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:3000'];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            securityLog('CORS_BLOCKED', { origin });
            callback(null, false); // Recusa o CORS graciosamente sem atirar erro 500 no servidor
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Middleware de Proteção para ficheiros HTML específicos
const authorizeHTML = (requiredRole) => {
    return (req, res, next) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');

        const token = req.cookies.maclau_token;
        if (!token) {
            securityLog('HTML_ACCESS_DENIED', { path: req.path, reason: 'no_token' });
            return res.redirect('/index.html?expired=1');
        }
        jwt.verify(token, SECRET_KEY, (err, decoded) => {
            if (err || (requiredRole && decoded.role !== requiredRole)) {
                securityLog('HTML_ACCESS_DENIED', { path: req.path, reason: 'invalid_token', role: requiredRole });
                return res.redirect('/index.html?expired=1');
            }
            next();
        });
    };
};

// Rotas HTML protegidas (devem vir antes de express.static)
app.get('/admin.html', authorizeHTML('admin'), (req, res, next) => {
    res.sendFile('admin.html', { root: path.join(__dirname, 'public') }, err => {
        if (err) {
            console.error('[ERROR] Falha ao enviar admin.html:', err);
            next(err);
        }
    });
});

app.get('/tecnico.html', authorizeHTML('tecnico'), (req, res, next) => {
    res.sendFile('tecnico.html', { root: path.join(__dirname, 'public') }, err => {
        if (err) {
            console.error('[ERROR] Falha ao enviar tecnico.html:', err);
            next(err);
        }
    });
});

app.get('/outros.html', authorizeHTML('admin'), (req, res, next) => {
    res.sendFile('outros.html', { root: path.join(__dirname, 'public') }, err => {
        if (err) next(err);
    });
});

app.get('/desenho.html', authorizeHTML('colaborador'), (req, res, next) => {
    res.sendFile('desenho.html', { root: path.join(__dirname, 'public') }, err => {
        if (err) next(err);
    });
});

app.get('/corte.html', authorizeHTML('tecnico_laser'), (req, res, next) => {
    res.sendFile('corte.html', { root: path.join(__dirname, 'public') }, err => {
        if (err) next(err);
    });
});

// 🔒 SEGURANÇA: Rota protegida para servir fotos dos relatórios
app.get('/uploads/reports/:filename', (req, res) => {
    const token = req.cookies.maclau_token || req.query.token;

    if (!token) {
        securityLog('PHOTO_ACCESS_DENIED', { path: req.path, reason: 'no_token' });
        return res.sendStatus(401);
    }

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) {
            securityLog('PHOTO_ACCESS_DENIED', { path: req.path, reason: 'invalid_token' });
            return res.sendStatus(403);
        }

        if (decoded.role !== 'admin' && decoded.role !== 'tecnico') {
            securityLog('PHOTO_ACCESS_DENIED', { path: req.path, reason: 'unauthorized_role', role: decoded.role });
            return res.sendStatus(403);
        }

        const filePath = path.join(__dirname, 'uploads', 'reports', req.params.filename);

        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            res.sendStatus(404);
        }
    });
});

app.use(express.static(path.join(__dirname, 'public')));

// 🔒 SEGURANÇA: Rate Limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2000,
    message: { error: "Demasiados pedidos a partir deste IP. Tente mais tarde." },
    standardHeaders: true,
    legacyHeaders: false,
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { error: "Demasiadas tentativas de login. Tente novamente após 15 minutos." },
    skipSuccessfulRequests: true,
});

const reportLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: "Limite de reportes atingido. Tente novamente mais tarde." }
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/public/avarias', reportLimiter);

// 🔒 CORREÇÃO: handleDBError NÃO vaza mensagem interna — apenas loga no servidor
const handleDBError = (res, err, customMsg = "Erro interno no servidor") => {
    console.error('[DB ERROR]', err);
    res.status(500).json({ error: customMsg });
};

const handleStockOrDBError = (res, err) => {
    if (err && err.isStockError) {
        return res.status(400).json({ error: err.message });
    }
    return handleDBError(res, err);
};

// Initialize DB
const db = new sqlite3.Database(path.join(__dirname, 'database.db'), (err) => {
    if (err) {
        console.error('Error opening database', err.message);
        process.exit(1);
    } else {
        console.log('✅ Connected to the SQLite database.');
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS clientes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL,
                telefone TEXT,
                email TEXT,
                manutencao_automatica INTEGER DEFAULT 0,
                manutencao_periodo TEXT DEFAULT NULL,
                manutencao_data_inicio TEXT DEFAULT NULL
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS administradores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                email TEXT
            )`);

            db.get(`SELECT COUNT(*) as count FROM administradores`, [], (err, row) => {
                if (!err && row && row.count === 0) {
                    const adminUser = process.env.ADMIN_USER;
                    const adminPass = process.env.ADMIN_PASS;

                    if (!adminUser || !adminPass) {
                        console.error('❌ ADMIN_USER e ADMIN_PASS devem estar definidos no .env');
                        process.exit(1);
                    }

                    const hash = bcrypt.hashSync(adminPass, 10);
                    db.run(`INSERT INTO administradores (username, password) VALUES (?, ?)`, [adminUser, hash]);
                    console.log(`✅ [AUTH] Utilizador Admin '${adminUser}' inicializado.`);
                } else {
                    console.log(`✅ [AUTH] Base de dados de administradores verificada.`);
                }
            });

            db.run(`CREATE TABLE IF NOT EXISTS maquinas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente_id INTEGER,
                marca TEXT,
                modelo TEXT,
                numero_serie TEXT,
                data_instalacao TEXT,
                data_inicio_garantia TEXT,
                data_fim_garantia TEXT,
                uuid TEXT NOT NULL UNIQUE,
                data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
                fornecedor TEXT,
                fatura_compra TEXT,
                FOREIGN KEY (cliente_id) REFERENCES clientes (id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS avarias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                maquina_id TEXT NOT NULL,
                tipo_avaria INTEGER NOT NULL,
                estado TEXT DEFAULT 'pendente',
                estado_faturacao TEXT DEFAULT 'Por Faturar', -- Por Faturar, Para Faturar, Faturado, Oferta, Garantia
                tecnico_id INTEGER,
                arquivada INTEGER DEFAULT 0,
                data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
                data_hora_inicio DATETIME,
                data_hora_fim DATETIME,
                relatorio TEXT,
                relatorio_submetido INTEGER DEFAULT 0,
                pecas_substituidas TEXT,
                horas_trabalho REAL,
                data_agendada DATETIME,
                numero_fatura TEXT,
                deslocacoes INTEGER DEFAULT 1,
                FOREIGN KEY (maquina_id) REFERENCES maquinas (uuid),
                FOREIGN KEY (tecnico_id) REFERENCES tecnicos (id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS tecnicos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL,
                especialidade TEXT,
                telefone TEXT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS utilizadores_cliente (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente_id INTEGER NOT NULL,
                nome TEXT NOT NULL,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                email TEXT,
                FOREIGN KEY (cliente_id) REFERENCES clientes (id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS servicos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente_id INTEGER NOT NULL,
                tecnico_id INTEGER,
                tipo_servico TEXT NOT NULL,
                tipo_camiao TEXT NOT NULL,
                estado TEXT DEFAULT 'pendente',
                estado_faturacao TEXT DEFAULT 'Por Faturar', -- Por Faturar, Para Faturar, Faturado, Oferta, Garantia
                arquivada INTEGER DEFAULT 0,
                data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
                data_hora_inicio DATETIME,
                data_hora_fim DATETIME,
                relatorio TEXT,
                relatorio_submetido INTEGER DEFAULT 0,
                pecas_substituidas TEXT,
                horas_trabalho REAL,
                notas TEXT,
                data_hora_pausa DATETIME,
                assinatura_cliente TEXT,
                assinatura_tecnico TEXT,
                data_agendada DATETIME,
                numero_fatura TEXT,
                deslocacoes INTEGER DEFAULT 1,
                FOREIGN KEY (cliente_id) REFERENCES clientes (id),
                FOREIGN KEY (tecnico_id) REFERENCES tecnicos (id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS manutencoes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente_id INTEGER NOT NULL,
                tecnico_id INTEGER,
                estado TEXT DEFAULT 'pendente',
                estado_faturacao TEXT DEFAULT 'Por Faturar', -- Por Faturar, Para Faturar, Faturado, Oferta, Garantia
                arquivada INTEGER DEFAULT 0,
                data_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
                data_hora_inicio DATETIME,
                data_hora_fim DATETIME,
                relatorio TEXT,
                relatorio_submetido INTEGER DEFAULT 0,
                pecas_substituidas TEXT,
                horas_trabalho REAL,
                notas TEXT,
                data_hora_pausa DATETIME,
                assinatura_cliente TEXT,
                assinatura_tecnico TEXT,
                data_agendada DATETIME,
                numero_fatura TEXT,
                deslocacoes INTEGER DEFAULT 1,
                FOREIGN KEY (cliente_id) REFERENCES clientes (id),
                FOREIGN KEY (tecnico_id) REFERENCES tecnicos (id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS fotos_relatorio (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                avaria_id INTEGER,
                servico_id INTEGER,
                manutencao_id INTEGER,
                caminho TEXT NOT NULL,
                data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (avaria_id) REFERENCES avarias (id),
                FOREIGN KEY (servico_id) REFERENCES servicos (id),
                FOREIGN KEY (manutencao_id) REFERENCES manutencoes (id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS manutencao_maquinas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                manutencao_id INTEGER NOT NULL,
                maquina_id INTEGER NOT NULL,
                FOREIGN KEY (manutencao_id) REFERENCES manutencoes (id) ON DELETE CASCADE,
                FOREIGN KEY (maquina_id) REFERENCES maquinas (id) ON DELETE CASCADE
            )`);

            db.serialize(() => {
                db.all(`SELECT id, password FROM tecnicos`, [], (err, rows) => {
                    if (!err && rows && rows.length > 0) {
                        const stmt = db.prepare(`UPDATE tecnicos SET password = ? WHERE id = ?`);
                        rows.forEach(row => {
                            if (row.password && row.password.length < 60) {
                                const hash = bcrypt.hashSync(row.password, 10);
                                stmt.run(hash, row.id);
                            }
                        });
                        stmt.finalize();
                        console.log('✅ [MIGRATION] Passwords migradas para bcrypt');
                    }
                });
            });

            db.run(`CREATE TABLE IF NOT EXISTS fault_types (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS frota (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                marca TEXT NOT NULL,
                modelo TEXT NOT NULL,
                ano INTEGER,
                data_proxima_inspecao DATE,
                proxima_revisao_kms INTEGER,
                data_ultima_revisao DATE
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS fornecedores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL,
                contacto TEXT,
                morada TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS produto (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome_produto TEXT NOT NULL,
                quantidade REAL NOT NULL DEFAULT 0,
                codigo_barras TEXT UNIQUE,
                data_ultima_adicao DATETIME,
                categoria_produto TEXT,
                unidade TEXT DEFAULT 'un',
                fornecedor_id INTEGER,
                FOREIGN KEY (fornecedor_id) REFERENCES fornecedores (id)
            )`);

            db.run(`ALTER TABLE produto ADD COLUMN unidade TEXT DEFAULT 'un'`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error("Migration error (unidade):", err);
                }
            });

            db.run(`ALTER TABLE produto ADD COLUMN fornecedor_id INTEGER`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error("Migration error (fornecedor_id):", err);
                }
            });

            db.run(`ALTER TABLE produto ADD COLUMN quantidade_minima REAL`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error("Migration error (quantidade_minima):", err);
                }
            });

            db.run(`CREATE TABLE IF NOT EXISTS movimentos_stock (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                produto_id INTEGER NOT NULL,
                quantidade REAL NOT NULL,
                tipo_movimento TEXT NOT NULL,
                referencia_id INTEGER,
                cliente_id INTEGER,
                utilizador_id INTEGER,
                utilizador_role TEXT,
                data_hora DATETIME,
                FOREIGN KEY (produto_id) REFERENCES produto(id) ON DELETE CASCADE,
                FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL
            )`);


            db.run(`CREATE TABLE IF NOT EXISTS checklists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                marca TEXT NOT NULL,
                modelo TEXT NOT NULL,
                titulo_avaria TEXT NOT NULL,
                descricao TEXT,
                data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS colaboradores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS tecnico_laser (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS laser_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cliente_nome TEXT NOT NULL,
                descricao TEXT,
                desenho_caminho TEXT,
                estado TEXT DEFAULT 'pendente',
                colaborador_id INTEGER,
                tecnico_laser_id INTEGER,
                data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
                data_hora_inicio DATETIME,
                data_hora_fim DATETIME,
                data_hora_pausa DATETIME,
                tempo_total_minutos INTEGER DEFAULT 0,
                tempo_total_segundos INTEGER DEFAULT 0,
                desenho_nome_original TEXT,
                FOREIGN KEY (colaborador_id) REFERENCES colaboradores (id),
                FOREIGN KEY (tecnico_laser_id) REFERENCES tecnico_laser (id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS checklists_passos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                checklist_id INTEGER NOT NULL,
                ordem INTEGER NOT NULL,
                descricao TEXT NOT NULL,
                FOREIGN KEY (checklist_id) REFERENCES checklists(id) ON DELETE CASCADE
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS anotacoes_tecnicos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tecnico_id INTEGER NOT NULL,
                cliente_id INTEGER NOT NULL,
                maquina_id TEXT,
                descricao TEXT NOT NULL,
                estado TEXT DEFAULT 'pendente',
                data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tecnico_id) REFERENCES tecnicos(id) ON DELETE CASCADE,
                FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS avaria_tecnicos (
                avaria_id INTEGER NOT NULL,
                tecnico_id INTEGER NOT NULL,
                PRIMARY KEY (avaria_id, tecnico_id),
                FOREIGN KEY (avaria_id) REFERENCES avarias(id) ON DELETE CASCADE,
                FOREIGN KEY (tecnico_id) REFERENCES tecnicos(id) ON DELETE CASCADE
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS servico_tecnicos (
                servico_id INTEGER NOT NULL,
                tecnico_id INTEGER NOT NULL,
                PRIMARY KEY (servico_id, tecnico_id),
                FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE CASCADE,
                FOREIGN KEY (tecnico_id) REFERENCES tecnicos(id) ON DELETE CASCADE
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS servico_maquinas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                servico_id INTEGER NOT NULL,
                maquina_id INTEGER NOT NULL,
                FOREIGN KEY (servico_id) REFERENCES servicos (id) ON DELETE CASCADE,
                FOREIGN KEY (maquina_id) REFERENCES maquinas (id) ON DELETE CASCADE
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS manutencao_tecnicos (
                manutencao_id INTEGER NOT NULL,
                tecnico_id INTEGER NOT NULL,
                PRIMARY KEY (manutencao_id, tecnico_id),
                FOREIGN KEY (manutencao_id) REFERENCES manutencoes(id) ON DELETE CASCADE,
                FOREIGN KEY (tecnico_id) REFERENCES tecnicos(id) ON DELETE CASCADE
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS componentes_maquina (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                modelo_maquina TEXT NOT NULL,
                referencia TEXT NOT NULL,
                nome TEXT NOT NULL,
                fornecedor TEXT NOT NULL
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS stock_maquinas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                marca TEXT NOT NULL,
                modelo TEXT NOT NULL,
                numero_serie TEXT,
                data_entrada DATETIME DEFAULT CURRENT_TIMESTAMP,
                fornecedor TEXT,
                fatura_compra TEXT,
                uuid TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS preparativos_avaria (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                avaria_id INTEGER NOT NULL,
                produto_id INTEGER NOT NULL,
                quantidade_levada REAL NOT NULL DEFAULT 0,
                quantidade_usada REAL DEFAULT 0,
                FOREIGN KEY (avaria_id) REFERENCES avarias(id) ON DELETE CASCADE,
                FOREIGN KEY (produto_id) REFERENCES produto(id) ON DELETE CASCADE
            )`);

            // --- MIGRATIONS ---
            const migrations = [
                { table: 'avarias', column: 'data_hora_inicio', type: 'DATETIME' },
                { table: 'avarias', column: 'data_hora_fim', type: 'DATETIME' },
                { table: 'avarias', column: 'relatorio', type: 'TEXT' },
                { table: 'avarias', column: 'relatorio_submetido', type: 'INTEGER DEFAULT 0' },
                { table: 'avarias', column: 'pecas_substituidas', type: 'TEXT' },
                { table: 'avarias', column: 'horas_trabalho', type: 'REAL' },
                { table: 'avarias', column: 'notas', type: 'TEXT' },
                { table: 'avarias', column: 'data_hora_pausa', type: 'DATETIME' },
                { table: 'avarias', column: 'assinatura_cliente', type: 'TEXT' },
                { table: 'avarias', column: 'assinatura_tecnico', type: 'TEXT' },
                { table: 'avarias', column: 'estado_faturacao', type: 'TEXT DEFAULT \'Por Faturar\'' },
                { table: 'avarias', column: 'data_agendada', type: 'DATETIME' },
                { table: 'servicos', column: 'assinatura_tecnico', type: 'TEXT' },
                { table: 'servicos', column: 'data_agendada', type: 'DATETIME' },
                { table: 'administradores', column: 'email', type: 'TEXT' },
                { table: 'clientes', column: 'morada', type: 'TEXT' },
                { table: 'clientes', column: 'NIF', type: 'TEXT' },
                { table: 'clientes', column: 'manutencao_automatica', type: 'INTEGER DEFAULT 0' },
                { table: 'clientes', column: 'manutencao_periodo', type: 'TEXT DEFAULT NULL' },
                { table: 'clientes', column: 'manutencao_data_inicio', type: 'TEXT DEFAULT NULL' },
                { table: 'fotos_relatorio', column: 'manutencao_id', type: 'INTEGER' },
                { table: 'laser_tasks', column: 'tempo_total_minutos', type: 'INTEGER DEFAULT 0' },
                { table: 'laser_tasks', column: 'tempo_total_segundos', type: 'INTEGER DEFAULT 0' },
                { table: 'laser_tasks', column: 'desenho_nome_original', type: 'TEXT' },
                { table: 'avarias', column: 'numero_fatura', type: 'TEXT' },
                { table: 'servicos', column: 'numero_fatura', type: 'TEXT' },
                { table: 'manutencoes', column: 'numero_fatura', type: 'TEXT' },
                { table: 'avarias', column: 'deslocacoes', type: 'INTEGER DEFAULT 1' },
                { table: 'servicos', column: 'deslocacoes', type: 'INTEGER DEFAULT 1' },
                { table: 'manutencoes', column: 'deslocacoes', type: 'INTEGER DEFAULT 1' },
                { table: 'avarias', column: 'tempo_acumulado', type: 'INTEGER DEFAULT 0' },
                { table: 'servicos', column: 'tempo_acumulado', type: 'INTEGER DEFAULT 0' },
                { table: 'manutencoes', column: 'tempo_acumulado', type: 'INTEGER DEFAULT 0' },
                { table: 'maquinas', column: 'fornecedor', type: 'TEXT' },
                { table: 'maquinas', column: 'fatura_compra', type: 'TEXT' },
                { table: 'stock_maquinas', column: 'fornecedor', type: 'TEXT' },
                { table: 'stock_maquinas', column: 'fatura_compra', type: 'TEXT' },
                { table: 'stock_maquinas', column: 'uuid', type: 'TEXT' }
            ];

            migrations.forEach(m => {
                db.run(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.type}`, (err) => {
                    // Ignorar erro de "coluna já existe"
                });
            });

            // Executar rotinas após todas as migrações/tabelas serem inicializadas sequencialmente
            db.run("SELECT 1", () => {
                // Populate multi-tech tables if empty
                db.get("SELECT COUNT(*) as count FROM avaria_tecnicos", [], (err, row) => {
                    if (row && row.count === 0) {
                        db.run(`INSERT INTO avaria_tecnicos (avaria_id, tecnico_id)
                                SELECT id, tecnico_id FROM avarias WHERE tecnico_id IS NOT NULL`);
                    }
                });
                db.get("SELECT COUNT(*) as count FROM servico_tecnicos", [], (err, row) => {
                    if (row && row.count === 0) {
                        db.run(`INSERT INTO servico_tecnicos (servico_id, tecnico_id)
                                SELECT id, tecnico_id FROM servicos WHERE tecnico_id IS NOT NULL`);
                    }
                });
                db.get("SELECT COUNT(*) as count FROM manutencao_tecnicos", [], (err, row) => {
                    if (row && row.count === 0) {
                        db.run(`INSERT INTO manutencao_tecnicos (manutencao_id, tecnico_id)
                                SELECT id, tecnico_id FROM manutencoes WHERE tecnico_id IS NOT NULL`);
                    }
                });

                // Gerar UUID para máquinas no stock existentes que não tenham UUID
                db.each(`SELECT id FROM stock_maquinas WHERE uuid IS NULL`, [], (err, row) => {
                    if (row) {
                        const newUuid = crypto.randomUUID();
                        db.run(`UPDATE stock_maquinas SET uuid = ? WHERE id = ?`, [newUuid, row.id]);
                    }
                });

                console.log('✅ Database initialization and migrations completed. Starting schedulers...');
                if (typeof checkVehicleInspections === 'function') checkVehicleInspections();
                if (typeof generateUpcomingMaintenances === 'function') generateUpcomingMaintenances();
            });
        });
    }
});

// --- Configuração Nodemailer ---
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

// Helper para enviar e-mail de atribuição
async function sendAssignmentEmail(tecnicoEmail, tecnicoNome, machineNome, clientNome, notas = '', type = 'avaria') {
    if (!process.env.SMTP_HOST || !tecnicoEmail) return;

    const isService = type === 'servico';
    const isManutencao = type === 'manutencao';
    const typeLabel = isManutencao ? 'Manutenção' : (isService ? 'Serviço' : 'Avaria');
    const accentColor = isManutencao ? '#7c3aed' : (isService ? '#1e3a8a' : '#2D5A27');
    const taskDescription = isManutencao ? 'uma nova tarefa de manutenção geral' : (isService ? 'uma nova tarefa de serviço (instalação/transporte)' : 'uma nova tarefa de manutenção');

    const mailOptions = {
        from: process.env.EMAIL_FROM || 'Maclau <noreply@maclau.pt>',
        to: tecnicoEmail,
        subject: `Novo/a ${typeLabel} Atribuído/a: ${machineNome}`,
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 30px;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <img src="cid:logo" alt="Maclau Logo" style="max-width: 150px; height: auto;">
                </div>
                <h1 style="color: ${accentColor}; font-size: 24px; margin-bottom: 20px;">Olá, ${tecnicoNome}!</h1>
                <p style="font-size: 16px; color: #64748B; margin-bottom: 24px;">Foi-lhe atribuída ${taskDescription}.</p>
                
                <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 24px; border-top: 4px solid ${accentColor};">
                    <p style="margin: 0 0 10px 0;"><strong>Cliente/Lavandaria:</strong> ${clientNome}</p>
                    <p style="margin: 0;"><strong>${isManutencao ? 'Tipo' : (isService ? 'Tipo de Serviço' : 'Máquina')}:</strong> ${machineNome}</p>
                </div>

                ${notas ? `
                <div style="margin-bottom: 24px;">
                    <h3 style="color: #475569; font-size: 14px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Notas Adicionais:</h3>
                    <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 15px; color: #92400e; font-style: italic; border-radius: 4px;">
                        ${notas}
                    </div>
                </div>
                ` : ''}
                
                <p style="font-size: 14px; color: #64748B;">Por favor, aceda ao seu portal para começar a trabalhar.</p>
                <div style="margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px; font-size: 12px; color: #94a3b8;">
                    Este é um e-mail automático enviado pelo sistema Maclau.
                </div>
            </div>
        `,
        attachments: [{
            filename: 'logo.png',
            path: path.join(__dirname, 'public', 'img', 'logo.png'),
            cid: 'logo'
        }]
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] Notificação enviada para: ${tecnicoEmail}`);
    } catch (error) {
        console.error('[EMAIL ERROR]', error);
    }
}

// Helper para notificar administradores de novas avarias
async function sendAdminNotificationEmail(adminEmails, machineNome, clientNome, tipoAvaria) {
    if (!process.env.SMTP_HOST || !adminEmails || adminEmails.length === 0) return;

    const tipoTexto = tipoAvaria === 1 ? 'Elétrica' : tipoAvaria === 3 ? 'Mecânica' : 'Desconhecida';

    const mailOptions = {
        from: process.env.EMAIL_FROM || 'Maclau <noreply@maclau.pt>',
        to: adminEmails.join(','),
        subject: `⚠️ ALERTA: Nova Avaria Reportada - ${clientNome}`,
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #fca5a5; border-radius: 12px; padding: 30px;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <img src="cid:logo" alt="Maclau Logo" style="max-width: 150px; height: auto;">
                </div>
                <h1 style="color: #b91c1c; font-size: 22px; margin-bottom: 20px;">Nova Avaria Reportada!</h1>
                <p style="font-size: 16px; color: #4b5563;">Um cliente acabou de reportar uma avaria através do sistema QR Code.</p>
                
                <div style="background: #fef2f2; padding: 20px; border-radius: 8px; margin-bottom: 24px; border-left: 4px solid #ef4444;">
                    <p style="margin: 0 0 10px 0;"><strong>Cliente:</strong> ${clientNome}</p>
                    <p style="margin: 0 0 10px 0;"><strong>Máquina:</strong> ${machineNome}</p>
                    <p style="margin: 0;"><strong>Tipo de Avaria:</strong> ${tipoTexto}</p>
                </div>

                <p style="font-size: 14px; color: #6b7280;">Por favor, aceda ao painel de administração para atribuir um técnico a esta ocorrência.</p>
                
                <div style="margin-top: 30px; border-top: 1px solid #fee2e2; padding-top: 20px; font-size: 12px; color: #9ca3af;">
                    Este é um alerta automático de segurança do sistema Maclau.
                </div>
            </div>
        `,
        attachments: [{
            filename: 'logo.png',
            path: path.join(__dirname, 'public', 'img', 'logo.png'),
            cid: 'logo'
        }]
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] Notificação de administrador enviada.`);
    } catch (error) {
        console.error('[EMAIL ERROR ADMIN]', error);
    }
}

// Helpers para stock crítico
function getUnitName(unit, qty) {
    const plural = qty !== 1;
    if (unit === 'un') return plural ? 'unidades' : 'unidade';
    if (unit === 'l') return plural ? 'litros' : 'litro';
    if (unit === 'kg') return plural ? 'kilos' : 'kilo';
    if (unit === 'm') return plural ? 'metros' : 'metro';
    return unit || '';
}

async function sendStockLimitEmail(adminEmails, productNome, currentQty, limitQty, unit) {
    if (!process.env.SMTP_HOST || !adminEmails || adminEmails.length === 0) return;

    const unitName = getUnitName(unit, currentQty);
    const limitUnitName = getUnitName(unit, limitQty);

    const mailOptions = {
        from: process.env.EMAIL_FROM || 'Maclau <noreply@maclau.pt>',
        to: adminEmails.join(','),
        subject: `⚠️ ALERTA DE STOCK MÍNIMO: ${productNome}`,
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #fca5a5; border-radius: 12px; padding: 30px;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <img src="cid:logo" alt="Maclau Logo" style="max-width: 150px; height: auto;">
                </div>
                <h1 style="color: #b91c1c; font-size: 20px; margin-bottom: 20px;">Alerta de Stock Crítico!</h1>
                <p style="font-size: 16px; color: #4b5563;">O produto <strong>"${productNome}"</strong> atingiu ou desceu abaixo do limite mínimo de stock configurado.</p>
                
                <div style="background: #fffbeb; padding: 20px; border-radius: 8px; margin-bottom: 24px; border-left: 4px solid #f59e0b;">
                    <p style="margin: 0 0 10px 0; font-size: 15px;"><strong>Produto:</strong> ${productNome}</p>
                    <p style="margin: 0 0 10px 0; font-size: 15px; color: #b91c1c;"><strong>Stock Atual:</strong> ${currentQty} ${unitName}</p>
                    <p style="margin: 0; font-size: 15px;"><strong>Limite Mínimo:</strong> ${limitQty} ${limitUnitName}</p>
                </div>

                <p style="font-size: 14px; color: #6b7280;">Por favor, providencie o reabastecimento do produto junto ao fornecedor.</p>
                
                <div style="margin-top: 30px; border-top: 1px solid #fee2e2; padding-top: 20px; font-size: 12px; color: #9ca3af;">
                    Este é um alerta automático de inventário do sistema Maclau.
                </div>
            </div>
        `,
        attachments: [{
            filename: 'logo.png',
            path: path.join(__dirname, 'public', 'img', 'logo.png'),
            cid: 'logo'
        }]
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] Alerta de stock mínimo enviado para: ${adminEmails.join(', ')}`);
    } catch (error) {
        console.error('[EMAIL ERROR] Falha ao enviar alerta de stock mínimo:', error);
    }
}

function checkAndNotifyStock(productId, newQty, prevQty) {
    db.get(`SELECT nome_produto, quantidade_minima, unidade FROM produto WHERE id = ?`, [productId], (err, row) => {
        if (err || !row) return;
        const limit = row.quantidade_minima;
        if (limit === null || limit === undefined) return;
        
        if (newQty <= limit && (prevQty === undefined || prevQty > limit)) {
            db.all(`SELECT email FROM administradores WHERE email IS NOT NULL`, [], (err, admins) => {
                if (!err && admins.length > 0) {
                    const adminEmails = admins.map(a => a.email);
                    sendStockLimitEmail(adminEmails, row.nome_produto, newQty, limit, row.unidade);
                }
            });
        }
    });
}

// Helper para alertas de frota
async function sendFrotaAlertEmail(adminEmails, vehicle, isToday = false) {
    if (!process.env.SMTP_HOST || !adminEmails || adminEmails.length === 0) return;

    const subject = isToday
        ? `ALERTA: Inspeção de Veículo HOJE - ${vehicle.marca} ${vehicle.modelo}`
        : `Lembrete: Inspeção de Veículo em 1 Semana - ${vehicle.marca} ${vehicle.modelo}`;

    const mailOptions = {
        from: process.env.EMAIL_FROM || 'Maclau <noreply@maclau.pt>',
        to: adminEmails.join(','),
        subject: subject,
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 30px;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <img src="cid:logo" alt="Maclau Logo" style="max-width: 150px; height: auto;">
                </div>
                <h1 style="color: #2D5A27; font-size: 24px; margin-bottom: 20px;">Alerta de Frota</h1>
                <p style="font-size: 16px; color: #64748B; margin-bottom: 24px;">
                    Este é um lembrete automático sobre a próxima inspeção do veículo:
                </p>
                
                <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 24px; border-top: 4px solid #2D5A27;">
                    <p style="margin: 0 0 10px 0;"><strong>Veículo:</strong> ${vehicle.marca} ${vehicle.modelo} (${vehicle.ano || 'N/A'})</p>
                    <p style="margin: 0;"><strong>Data da Inspeção:</strong> ${vehicle.data_proxima_inspecao ? vehicle.data_proxima_inspecao.split('-').reverse().join('/') : 'N/A'}</p>
                </div>

                <p style="font-size: 16px; color: #1E293B;">
                    ${isToday ? '⚠️ A inspeção deve ser realizada <strong>HOJE</strong>.' : 'ℹ️ A inspeção está agendada para daqui a <strong>7 dias</strong>.'}
                </p>
                
                <div style="margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px; font-size: 12px; color: #94a3b8;">
                    Este é um e-mail automático enviado pelo sistema Maclau.
                </div>
            </div>
        `,
        attachments: [{
            filename: 'logo.png',
            path: path.join(__dirname, 'public', 'img', 'logo.png'),
            cid: 'logo'
        }]
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] Alerta de frota enviado para: ${adminEmails.join(', ')}`);
    } catch (error) {
        console.error('[EMAIL ERROR FROTA]', error);
    }
}

// Helper para enviar credenciais de acesso ao cliente
async function sendClientCredentialsEmail(email, nome, username, password) {
    if (!process.env.SMTP_HOST || !email) return;

    const mailOptions = {
        from: process.env.EMAIL_FROM || 'Maclau <noreply@maclau.pt>',
        to: email,
        subject: `Bem-vindo à Maclau - As suas credenciais de acesso`,
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 30px;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <img src="cid:logo" alt="Maclau Logo" style="max-width: 150px; height: auto;">
                </div>
                <h1 style="color: #2D5A27; font-size: 24px; margin-bottom: 20px;">Olá, ${nome}!</h1>
                <p style="font-size: 16px; color: #64748B; margin-bottom: 24px;">A sua conta de cliente Maclau foi criada com sucesso.</p>
                
                <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 24px; border-top: 4px solid #2D5A27;">
                    <p style="margin: 0 0 10px 0; font-size: 16px;">Aqui estão as suas credenciais de acesso de modo a poder reportar avarias:</p>
                    <p style="margin: 0 0 10px 0;"><strong>Username:</strong> ${username}</p>
                    <p style="margin: 0;"><strong>Password:</strong> ${password}</p>
                </div>

                <p style="font-size: 14px; color: #64748B;">Recomendamos que guarde a sua password em local seguro.</p>
                
                <div style="margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px; font-size: 12px; color: #94a3b8;">
                    Este é um e-mail automático enviado pelo sistema Maclau.
                </div>
            </div>
        `,
        attachments: [{
            filename: 'logo.png',
            path: path.join(__dirname, 'public', 'img', 'logo.png'),
            cid: 'logo'
        }]
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] Credenciais enviadas para: ${email}`);
    } catch (error) {
        console.error('[EMAIL ERROR CREDENTIALS]', error);
    }
}

// Função para verificar inspeções
function checkVehicleInspections() {
    console.log('[FROTA] A verificar inspeções agendadas...');

    db.all(`SELECT email FROM administradores WHERE email IS NOT NULL AND email != ''`, [], (err, admins) => {
        if (err || !admins || admins.length === 0) return;
        const adminEmails = admins.map(a => a.email);

        const today = new Date().toISOString().split('T')[0];
        const nextWeekDate = new Date();
        nextWeekDate.setDate(nextWeekDate.getDate() + 7);
        const nextWeek = nextWeekDate.toISOString().split('T')[0];

        db.all(`SELECT * FROM frota WHERE data_proxima_inspecao = ?`, [today], (err, vehiclesToday) => {
            if (!err && vehiclesToday) {
                vehiclesToday.forEach(v => sendFrotaAlertEmail(adminEmails, v, true));
            }
        });

        db.all(`SELECT * FROM frota WHERE data_proxima_inspecao = ?`, [nextWeek], (err, vehiclesNextWeek) => {
            if (!err && vehiclesNextWeek) {
                vehiclesNextWeek.forEach(v => sendFrotaAlertEmail(adminEmails, v, false));
            }
        });
    });
}

// Geração automática de manutenções recorrentes
function generateUpcomingMaintenances() {
    console.log('[SCHEDULE] A verificar manutenções automáticas...');
    db.all(`SELECT id, manutencao_periodo, manutencao_data_inicio FROM clientes WHERE manutencao_automatica = 1`, [], (err, clients) => {
        if (err) {
            console.error('[DB ERROR] Error fetching auto maintenance clients:', err);
            return;
        }
        if (!clients || clients.length === 0) return;

        clients.forEach(client => {
            generateClientMaintenances(client.id, client.manutencao_periodo, client.manutencao_data_inicio);
        });
    });
}

function generateClientMaintenances(clientId, periodo, dataInicio) {
    let monthsToAdd = 3; // default trimestral
    if (periodo === 'mensal') monthsToAdd = 1;
    else if (periodo === 'semestral') monthsToAdd = 6;

    // Buscar a data de manutenção agendada mais recente para este cliente
    db.get(
        `SELECT MAX(data_agendada) as latest_date FROM manutencoes WHERE cliente_id = ? AND data_agendada IS NOT NULL`,
        [clientId],
        (err, row) => {
            if (err) {
                console.error(`[DB ERROR] Error fetching latest maintenance for client ${clientId}:`, err);
                return;
            }

            let startDate;
            let isFirst = false;

            if (row && row.latest_date) {
                startDate = new Date(row.latest_date);
            } else if (dataInicio) {
                startDate = new Date(dataInicio + 'T09:00:00');
                isFirst = true; // Inserir o primeiro na própria data de início
            } else {
                startDate = new Date();
                startDate.setHours(9, 0, 0, 0);
                isFirst = true;
            }

            // Manter agendamentos até 12 meses no futuro
            const oneYearFromNow = new Date();
            oneYearFromNow.setMonth(oneYearFromNow.getMonth() + 12);

            let nextDate = new Date(startDate.getTime());

            function insertNext() {
                if (isFirst) {
                    isFirst = false; // Insere o primeiro na data inicial
                } else {
                    nextDate.setMonth(nextDate.getMonth() + monthsToAdd);
                }

                if (nextDate > oneYearFromNow) {
                    return; // Parar quando ultrapassar a janela de 12 meses
                }

                // Formatar para YYYY-MM-DD HH:mm:ss locais para guardar na BD
                const year = nextDate.getFullYear();
                const month = String(nextDate.getMonth() + 1).padStart(2, '0');
                const day = String(nextDate.getDate()).padStart(2, '0');
                const hours = String(nextDate.getHours()).padStart(2, '0');
                const minutes = String(nextDate.getMinutes()).padStart(2, '0');
                const seconds = String(nextDate.getSeconds()).padStart(2, '0');
                const dateString = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

                db.run(
                    `INSERT INTO manutencoes (cliente_id, tecnico_id, estado, data_hora, data_agendada, notas) VALUES (?, NULL, 'pendente', CURRENT_TIMESTAMP, ?, ?)`,
                    [clientId, dateString, 'Gerado automaticamente por agendamento recorrente.'],
                    function(err) {
                        if (err) {
                            console.error(`[DB ERROR] Error inserting auto maintenance for client ${clientId}:`, err);
                            return;
                        }
                        console.log(`[SCHEDULE] Manutenção automática criada para cliente ${clientId} na data ${dateString}`);
                        insertNext(); // Próxima inserção recursiva
                    }
                );
            }

            insertNext();
        }
    );
}

// Regeneração de agendamentos automáticos após alteração de definições do cliente
function regenerateClientAutoMaintenances(clientId, callback) {
    db.run(
        `DELETE FROM manutencoes WHERE cliente_id = ? AND tecnico_id IS NULL AND estado = 'pendente' AND data_agendada > strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')`,
        [clientId],
        function(err) {
            if (err) {
                console.error(`[DB ERROR] Error deleting future auto maintenances for client ${clientId}:`, err);
                if (callback) callback(err);
                return;
            }
            console.log(`[SCHEDULE] Removidos agendamentos automáticos futuros sem técnico para cliente ${clientId}`);
            
            db.get(`SELECT id, manutencao_automatica, manutencao_periodo, manutencao_data_inicio FROM clientes WHERE id = ?`, [clientId], (err, client) => {
                if (err) {
                    console.error('[DB ERROR] Error fetching updated client data:', err);
                    if (callback) callback(err);
                    return;
                }
                if (client && client.manutencao_automatica === 1) {
                    generateClientMaintenances(client.id, client.manutencao_periodo, client.manutencao_data_inicio);
                }
                if (callback) callback(null);
            });
        }
    );
}

// 🔒 CORREÇÃO: scheduleDailyCheck corrigido — sem double-fire no primeiro dia
// Usa setTimeout recursivo para garantir que corre exactamente uma vez por dia às 08:00
function scheduleDailyCheck() {
    const now = new Date();
    const nextCheck = new Date();
    nextCheck.setHours(8, 0, 0, 0);

    if (nextCheck <= now) {
        nextCheck.setDate(nextCheck.getDate() + 1);
    }

    const delay = nextCheck - now;
    console.log(`[SCHEDULE] Próxima verificação de frota em ${(delay / 1000 / 60 / 60).toFixed(2)} horas.`);

    setTimeout(() => {
        checkVehicleInspections();
        generateUpcomingMaintenances();
        scheduleDailyCheck(); // reagendar para o dia seguinte (recursivo)
    }, delay);
}

// 🔒 SEGURANÇA: Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing DB');
    db.close((err) => {
        if (err) console.error(err);
        console.log('Database connection closed.');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing DB');
    db.close((err) => {
        if (err) console.error(err);
        console.log('Database connection closed.');
        process.exit(0);
    });
});

// Middleware de verificação JWT
const authenticateJWT = (req, res, next) => {
    let token = req.cookies.maclau_token; // Tentar cookie primeiro

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (req.query.token) {
        token = req.query.token;
    }

    if (!token || token === 'null' || token === 'undefined') {
        return res.sendStatus(401);
    }

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            securityLog('JWT_VERIFICATION_FAILED', { error: err.message, ip: req.ip });
            return res.sendStatus(403);
        }
        req.user = user;
        next();
    });
};

// Middlewares de Autorização
const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') next();
    else {
        securityLog('UNAUTHORIZED_ACCESS', { role: req.user?.role, required: 'admin', ip: req.ip });
        res.status(403).json({ error: "Acesso negado: Requer privilégios de Administrador" });
    }
};

const isTecnico = (req, res, next) => {
    if (req.user && req.user.role === 'tecnico') next();
    else {
        securityLog('UNAUTHORIZED_ACCESS', { role: req.user?.role, required: 'tecnico', ip: req.ip });
        res.status(403).json({ error: "Acesso negado: Requer conta de Técnico" });
    }
};

const isAdminOrTecnico = (req, res, next) => {
    if (req.user && (req.user.role === 'admin' || req.user.role === 'tecnico')) next();
    else {
        securityLog('UNAUTHORIZED_ACCESS', { role: req.user?.role, required: 'admin_or_tecnico', ip: req.ip });
        res.status(403).json({ error: "Acesso negado" });
    }
};

const isColaborador = (req, res, next) => {
    if (req.user && req.user.role === 'colaborador') next();
    else {
        securityLog('UNAUTHORIZED_ACCESS', { role: req.user?.role, required: 'colaborador', ip: req.ip });
        res.status(403).json({ error: "Acesso negado: Requer conta de Colaborador (Desenho)" });
    }
};

const isTecnicoLaser = (req, res, next) => {
    if (req.user && req.user.role === 'tecnico_laser') next();
    else {
        securityLog('UNAUTHORIZED_ACCESS', { role: req.user?.role, required: 'tecnico_laser', ip: req.ip });
        res.status(403).json({ error: "Acesso negado: Requer conta de Técnico Laser (Corte)" });
    }
};

// API: Autenticação
// 🔒 CORREÇÃO: Apenas UMA rota de logout (a duplicada foi removida)
app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('maclau_token');
    securityLog('LOGOUT_SUCCESS', { ip: req.ip });
    res.json({ success: true, message: 'Logout efetuado com sucesso' });
});

app.post('/api/auth/login', (req, res) => {
    const { email, password, remember, redirect } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email e password são obrigatórios" });
    }

    // 1. Tentar login como Administrator
    db.get(`SELECT id, username, password FROM administradores WHERE username = ?`, [email], (err, row) => {
        if (err) return handleDBError(res, err);

        if (row) {
            const match = bcrypt.compareSync(password, row.password);
            if (match) {
                const expTime = remember ? '30d' : '8h';
                const maxAgeMs = remember ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000;

                const accessToken = jwt.sign(
                    { id: row.id, username: row.username, role: 'admin' },
                    SECRET_KEY,
                    { expiresIn: expTime, algorithm: 'HS256' }
                );

                res.cookie('maclau_token', accessToken, {
                    httpOnly: true,
                    secure: process.env.COOKIE_SECURE === 'true' || (process.env.NODE_ENV === 'production' && req.protocol === 'https'),
                    sameSite: 'strict',
                    maxAge: maxAgeMs
                });

                securityLog('LOGIN_SUCCESS', { user: row.username, role: 'admin', ip: req.ip });
                return res.json({ accessToken, role: 'admin', redirectUrl: redirect || 'admin.html' });
            } else {
                securityLog('LOGIN_FAILED', { user: email, role: 'admin', reason: 'wrong_password', ip: req.ip });
            }
        }

        // 2. Tentar login como Técnico
        db.get(`SELECT id, nome, password FROM tecnicos WHERE email = ?`, [email], (err, row) => {
            if (err) return handleDBError(res, err);

            if (row) {
                const match = bcrypt.compareSync(password, row.password);
                if (match) {
                    const expTime = remember ? '30d' : '8h';
                    const maxAgeMs = remember ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000;

                    const accessToken = jwt.sign(
                        { id: row.id, role: 'tecnico' },
                        SECRET_KEY,
                        { expiresIn: expTime, algorithm: 'HS256' }
                    );

                    res.cookie('maclau_token', accessToken, {
                        httpOnly: true,
                        secure: process.env.COOKIE_SECURE === 'true' || (process.env.NODE_ENV === 'production' && req.protocol === 'https'),
                        sameSite: 'strict',
                        maxAge: maxAgeMs
                    });

                    securityLog('LOGIN_SUCCESS', { user: email, role: 'tecnico', ip: req.ip });
                    return res.json({
                        accessToken,
                        role: 'tecnico',
                        redirectUrl: redirect || `tecnico.html?id=${row.id}&name=${encodeURIComponent(row.nome)}`
                    });
                } else {
                    securityLog('LOGIN_FAILED', { user: email, role: 'tecnico', reason: 'wrong_password', ip: req.ip });
                }
            }

            // 3. Tentar login como Utilizador de Cliente
            db.get(`SELECT id, cliente_id, nome, password FROM utilizadores_cliente WHERE username = ? OR email = ?`, [email, email], (err, row) => {
                if (err) return handleDBError(res, err);

                if (row) {
                    const match = bcrypt.compareSync(password, row.password);
                    if (match) {
                        const expTime = remember ? '30d' : '24h';
                        const maxAgeMs = remember ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

                        const accessToken = jwt.sign(
                            { id: row.id, cliente_id: row.cliente_id, role: 'cliente' },
                            SECRET_KEY,
                            { expiresIn: expTime, algorithm: 'HS256' }
                        );

                        res.cookie('maclau_token', accessToken, {
                            httpOnly: true,
                            secure: process.env.COOKIE_SECURE === 'true' || (process.env.NODE_ENV === 'production' && req.protocol === 'https'),
                            sameSite: 'strict',
                            maxAge: maxAgeMs
                        });

                        securityLog('LOGIN_SUCCESS_CLIENTE', { user: email, cliente_id: row.cliente_id, ip: req.ip });

                        return res.json({
                            accessToken,
                            role: 'cliente',
                            redirectUrl: redirect || 'dashboard_cliente_placeholder'
                        });
                    } else {
                        securityLog('LOGIN_FAILED_CLIENTE', { user: email, reason: 'wrong_password', ip: req.ip });
                    }
                }

                // 4. Tentar login como Colaborador (Desenho)
                db.get(`SELECT id, nome, password FROM colaboradores WHERE email = ?`, [email], (err, row) => {
                    if (err) return handleDBError(res, err);

                    if (row) {
                        const match = bcrypt.compareSync(password, row.password);
                        if (match) {
                            const expTime = remember ? '30d' : '8h';
                            const maxAgeMs = remember ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000;

                            const accessToken = jwt.sign(
                                { id: row.id, role: 'colaborador' },
                                SECRET_KEY,
                                { expiresIn: expTime, algorithm: 'HS256' }
                            );

                            res.cookie('maclau_token', accessToken, {
                                httpOnly: true,
                                secure: process.env.COOKIE_SECURE === 'true' || (process.env.NODE_ENV === 'production' && req.protocol === 'https'),
                                sameSite: 'strict',
                                maxAge: maxAgeMs
                            });

                            securityLog('LOGIN_SUCCESS', { user: email, role: 'colaborador', ip: req.ip });
                            return res.json({
                                accessToken,
                                role: 'colaborador',
                                redirectUrl: redirect || `desenho.html?id=${row.id}&name=${encodeURIComponent(row.nome)}`
                            });
                        }
                    }

                    // 5. Tentar login como Tecnico Laser (Corte)
                    db.get(`SELECT id, nome, password FROM tecnico_laser WHERE email = ?`, [email], (err, row) => {
                        if (err) return handleDBError(res, err);

                        if (row) {
                            const match = bcrypt.compareSync(password, row.password);
                            if (match) {
                                const expTime = remember ? '30d' : '8h';
                                const maxAgeMs = remember ? 30 * 24 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000;

                                const accessToken = jwt.sign(
                                    { id: row.id, role: 'tecnico_laser' },
                                    SECRET_KEY,
                                    { expiresIn: expTime, algorithm: 'HS256' }
                                );

                                res.cookie('maclau_token', accessToken, {
                                    httpOnly: true,
                                    secure: process.env.COOKIE_SECURE === 'true' || (process.env.NODE_ENV === 'production' && req.protocol === 'https'),
                                    sameSite: 'strict',
                                    maxAge: maxAgeMs
                                });

                                securityLog('LOGIN_SUCCESS', { user: email, role: 'tecnico_laser', ip: req.ip });
                                return res.json({
                                    accessToken,
                                    role: 'tecnico_laser',
                                    redirectUrl: redirect || `corte.html?id=${row.id}&name=${encodeURIComponent(row.nome)}`
                                });
                            }
                        }

                        securityLog('LOGIN_FAILED', { user: email, reason: 'user_not_found_or_wrong_pass', ip: req.ip });
                        return res.status(401).json({ error: 'Credenciais inválidas' });
                    });
                });
            });
        });
    });
});

// --- ADMIN ROUTES ---

// --- GESTÃO DE STOCK ---

app.get('/api/stock/movimentos', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT m.*,
               p.nome_produto,
               p.unidade,
               CASE 
                   WHEN m.utilizador_role = 'admin' THEN (SELECT username FROM administradores WHERE id = m.utilizador_id)
                   WHEN m.utilizador_role = 'tecnico' THEN (SELECT nome FROM tecnicos WHERE id = m.utilizador_id)
                   ELSE 'Sistema'
               END as utilizador_nome,
               c.nome as cliente_nome
        FROM movimentos_stock m
        LEFT JOIN produto p ON m.produto_id = p.id
        LEFT JOIN clientes c ON m.cliente_id = c.id
        ORDER BY m.data_hora DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/stock', authenticateJWT, isAdmin, (req, res) => {
    db.all(`SELECT p.*, f.nome as fornecedor_nome FROM produto p LEFT JOIN fornecedores f ON p.fornecedor_id = f.id ORDER BY p.nome_produto ASC`, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/stock/barcode/:barcode', authenticateJWT, isAdmin, (req, res) => {
    const { barcode } = req.params;
    if (barcode && barcode.startsWith('PROD-')) {
        const id = parseInt(barcode.replace('PROD-', ''), 10);
        db.get(`SELECT p.*, f.nome as fornecedor_nome FROM produto p LEFT JOIN fornecedores f ON p.fornecedor_id = f.id WHERE p.id = ?`, [id], (err, row) => {
            if (err) return handleDBError(res, err);
            if (!row) return res.status(404).json({ error: "Produto não encontrado" });
            res.json(row);
        });
    } else {
        db.get(`SELECT p.*, f.nome as fornecedor_nome FROM produto p LEFT JOIN fornecedores f ON p.fornecedor_id = f.id WHERE p.codigo_barras = ?`, [barcode], (err, row) => {
            if (err) return handleDBError(res, err);
            if (!row) return res.status(404).json({ error: "Produto não encontrado" });
            res.json(row);
        });
    }
});

app.post('/api/stock', authenticateJWT, isAdmin, (req, res) => {
    let { nome_produto, quantidade, codigo_barras, categoria_produto, unidade, fornecedor_id, quantidade_minima } = req.body;
    
    nome_produto = sanitizeString(nome_produto);
    codigo_barras = sanitizeString(codigo_barras);
    categoria_produto = sanitizeString(categoria_produto);
    unidade = sanitizeString(unidade) || 'un';
    const qty = parseFloat(quantidade) || 0;
    const f_id = fornecedor_id ? parseInt(fornecedor_id) : null;
    const qty_min = quantidade_minima !== undefined && quantidade_minima !== '' && quantidade_minima !== null ? parseFloat(quantidade_minima) : null;
    
    if (!nome_produto) return res.status(400).json({ error: "Nome do produto é obrigatório" });
    if (qty < 0) return res.status(400).json({ error: "A quantidade não pode ser negativa" });
    if (qty_min !== null && qty_min < 0) return res.status(400).json({ error: "A quantidade mínima não pode ser negativa" });
    
    const dateUltimaAdicao = qty > 0 ? new Date().toISOString() : null;
    
    if (codigo_barras) {
        db.get(`SELECT id FROM produto WHERE codigo_barras = ?`, [codigo_barras], (err, row) => {
            if (err) return handleDBError(res, err);
            if (row) return res.status(400).json({ error: "Já existe um produto com este código de barras" });
            insertProduct();
        });
    } else {
        insertProduct();
    }
    
    function insertProduct() {
        db.run(
            `INSERT INTO produto (nome_produto, quantidade, codigo_barras, data_ultima_adicao, categoria_produto, unidade, fornecedor_id, quantidade_minima) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [nome_produto, qty, codigo_barras || null, dateUltimaAdicao, categoria_produto || null, unidade, f_id, qty_min],
            function (err) {
                if (err) return handleDBError(res, err);
                const newProductId = this.lastID;
                
                if (qty > 0) {
                    const dateStr = new Date().toISOString();
                    db.run(`
                        INSERT INTO movimentos_stock (produto_id, quantidade, tipo_movimento, referencia_id, cliente_id, utilizador_id, utilizador_role, data_hora)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, [newProductId, qty, 'registo_inicial', null, null, req.user.id, 'admin', dateStr], (movErr) => {
                        if (movErr) console.error("Erro ao registar movimento de stock:", movErr);
                    });
                }
                
                // Realizar verificação de stock mínimo após inserção
                checkAndNotifyStock(newProductId, qty);
                
                res.status(201).json({
                    id: newProductId,
                    nome_produto,
                    quantidade: qty,
                    codigo_barras: codigo_barras || null,
                    data_ultima_adicao: dateUltimaAdicao,
                    categoria_produto: categoria_produto || null,
                    unidade,
                    fornecedor_id: f_id,
                    quantidade_minima: qty_min
                });
            }
        );
    }
});

app.put('/api/stock/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    let { nome_produto, quantidade, codigo_barras, categoria_produto, unidade, fornecedor_id, quantidade_minima } = req.body;
    
    nome_produto = sanitizeString(nome_produto);
    codigo_barras = sanitizeString(codigo_barras);
    categoria_produto = sanitizeString(categoria_produto);
    unidade = sanitizeString(unidade) || 'un';
    const qty = quantidade !== undefined && quantidade !== null && quantidade !== '' ? parseFloat(quantidade) : null;
    const f_id = fornecedor_id ? parseInt(fornecedor_id) : null;
    const qty_min = quantidade_minima !== undefined && quantidade_minima !== '' && quantidade_minima !== null ? parseFloat(quantidade_minima) : null;
    
    if (!nome_produto) return res.status(400).json({ error: "Nome do produto é obrigatório" });
    if (qty !== null && qty < 0) return res.status(400).json({ error: "A quantidade não pode ser negativa" });
    if (qty_min !== null && qty_min < 0) return res.status(400).json({ error: "A quantidade mínima não pode ser negativa" });
    
    if (codigo_barras) {
        db.get(`SELECT id FROM produto WHERE codigo_barras = ? AND id != ?`, [codigo_barras, id], (err, row) => {
            if (err) return handleDBError(res, err);
            if (row) return res.status(400).json({ error: "Já existe outro produto com este código de barras" });
            updateProduct();
        });
    } else {
        updateProduct();
    }
    
    function updateProduct() {
        db.get(`SELECT quantidade, quantidade_minima FROM produto WHERE id = ?`, [id], (err, row) => {
            if (err) return handleDBError(res, err);
            if (!row) return res.status(404).json({ error: "Produto não encontrado" });
            
            const finalQty = qty !== null ? qty : row.quantidade;
            let dateUltimaAdicao = null;
            if (finalQty > row.quantidade) {
                dateUltimaAdicao = new Date().toISOString();
            }
            
            const query = dateUltimaAdicao 
                ? `UPDATE produto SET nome_produto = ?, quantidade = ?, codigo_barras = ?, data_ultima_adicao = ?, categoria_produto = ?, unidade = ?, fornecedor_id = ?, quantidade_minima = ? WHERE id = ?`
                : `UPDATE produto SET nome_produto = ?, quantidade = ?, codigo_barras = ?, categoria_produto = ?, unidade = ?, fornecedor_id = ?, quantidade_minima = ? WHERE id = ?`;
            
            const params = dateUltimaAdicao
                ? [nome_produto, finalQty, codigo_barras || null, dateUltimaAdicao, categoria_produto || null, unidade, f_id, qty_min, id]
                : [nome_produto, finalQty, codigo_barras || null, categoria_produto || null, unidade, f_id, qty_min, id];
                
            db.run(query, params, function (err) {
                if (err) return handleDBError(res, err);
                
                // Realizar verificação de stock mínimo após atualização
                checkAndNotifyStock(id, finalQty, row.quantidade);
                
                res.json({ message: "Produto updated com sucesso" });
            });
        });
    }
});

app.put('/api/stock/:id/quantity', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { delta } = req.body;
    
    const diff = parseFloat(delta);
    if (isNaN(diff)) return res.status(400).json({ error: "Diferença de quantidade inválida" });
    
    db.get(`SELECT quantidade FROM produto WHERE id = ?`, [id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Produto não encontrado" });
        
        const newQty = row.quantidade + diff;
        if (newQty < 0) return res.status(400).json({ error: "A quantidade resultante não pode ser negativa" });
        
        const dateUltimaAdicao = diff > 0 ? new Date().toISOString() : null;
        
        const query = dateUltimaAdicao
            ? `UPDATE produto SET quantidade = ?, data_ultima_adicao = ? WHERE id = ?`
            : `UPDATE produto SET quantidade = ? WHERE id = ?`;
            
        const params = dateUltimaAdicao ? [newQty, dateUltimaAdicao, id] : [newQty, id];
        
        db.run(query, params, function(err) {
            if (err) return handleDBError(res, err);
            
            // Registar movimento
            const dateStr = new Date().toISOString();
            db.run(`
                INSERT INTO movimentos_stock (produto_id, quantidade, tipo_movimento, referencia_id, cliente_id, utilizador_id, utilizador_role, data_hora)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [id, diff, 'ajuste_manual', null, null, req.user.id, 'admin', dateStr], (movErr) => {
                if (movErr) console.error("Erro ao registar movimento de stock:", movErr);
            });

            // Realizar verificação de stock mínimo após ajuste de quantidade
            checkAndNotifyStock(id, newQty, row.quantidade);
            
            res.json({ message: "Quantidade atualizada", quantidade: newQty });
        });
    });
});

app.put('/api/stock/barcode/:barcode/increment', authenticateJWT, isAdmin, (req, res) => {
    const { barcode } = req.params;
    
    const query = barcode && barcode.startsWith('PROD-')
        ? `SELECT id, nome_produto, quantidade FROM produto WHERE id = ?`
        : `SELECT id, nome_produto, quantidade FROM produto WHERE codigo_barras = ?`;
    
    const param = barcode && barcode.startsWith('PROD-')
        ? parseInt(barcode.replace('PROD-', ''), 10)
        : barcode;
        
    db.get(query, [param], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Produto não encontrado" });
        
        const newQty = row.quantidade + 1;
        const dateUltimaAdicao = new Date().toISOString();
        
        db.run(
            `UPDATE produto SET quantidade = ?, data_ultima_adicao = ? WHERE id = ?`,
            [newQty, dateUltimaAdicao, row.id],
            function(err) {
                if (err) return handleDBError(res, err);
                
                // Registar movimento
                const dateStr = new Date().toISOString();
                db.run(`
                    INSERT INTO movimentos_stock (produto_id, quantidade, tipo_movimento, referencia_id, cliente_id, utilizador_id, utilizador_role, data_hora)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [row.id, 1, 'adicao_codigo_barras', null, null, req.user.id, 'admin', dateStr], (movErr) => {
                    if (movErr) console.error("Erro ao registar movimento de stock:", movErr);
                });

                // Realizar verificação de stock mínimo após incremento
                checkAndNotifyStock(row.id, newQty, row.quantidade);
                
                res.json({ message: "Quantidade updated", id: row.id, nome_produto: row.nome_produto, quantidade: newQty });
            }
        );
    });
});

app.delete('/api/stock/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM produto WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        res.json({ message: "Produto eliminado com sucesso" });
    });
});

app.get('/api/stock/:id/qrcode', authenticateJWT, isAdmin, async (req, res) => {
    const { id } = req.params;
    const value = `PROD-${id}`;
    
    try {
        const qrCodeDataUrl = await qrcode.toDataURL(value);
        res.json({ qrCode: qrCodeDataUrl, value });
    } catch (err) {
        res.status(500).json({ error: "Falha ao gerar QR Code para o produto" });
    }
});

// --- GESTÃO DE FORNECEDORES ---

app.get('/api/fornecedores', authenticateJWT, isAdmin, (req, res) => {
    db.all(`SELECT * FROM fornecedores ORDER BY nome ASC`, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/fornecedores/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.get(`SELECT * FROM fornecedores WHERE id = ?`, [id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Fornecedor não encontrado" });
        res.json(row);
    });
});

app.post('/api/fornecedores', authenticateJWT, isAdmin, (req, res) => {
    let { nome, contacto, morada } = req.body;
    nome = sanitizeString(nome);
    contacto = sanitizeString(contacto);
    morada = sanitizeString(morada);
    
    if (!nome) return res.status(400).json({ error: "Nome do fornecedor é obrigatório" });
    
    db.run(
        `INSERT INTO fornecedores (nome, contacto, morada) VALUES (?, ?, ?)`,
        [nome, contacto || null, morada || null],
        function (err) {
            if (err) return handleDBError(res, err);
            res.status(201).json({
                id: this.lastID,
                nome,
                contacto: contacto || null,
                morada: morada || null
            });
        }
    );
});

app.put('/api/fornecedores/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    let { nome, contacto, morada } = req.body;
    nome = sanitizeString(nome);
    contacto = sanitizeString(contacto);
    morada = sanitizeString(morada);
    
    if (!nome) return res.status(400).json({ error: "Nome do fornecedor é obrigatório" });
    
    db.run(
        `UPDATE fornecedores SET nome = ?, contacto = ?, morada = ? WHERE id = ?`,
        [nome, contacto || null, morada || null, id],
        function (err) {
            if (err) return handleDBError(res, err);
            res.json({ message: "Fornecedor atualizado com sucesso" });
        }
    );
});

app.delete('/api/fornecedores/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    
    db.get(`SELECT COUNT(*) as count FROM produto WHERE fornecedor_id = ?`, [id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (row && row.count > 0) {
            return res.status(400).json({ error: "Não é possível eliminar este fornecedor porque tem produtos associados" });
        }
        
        db.run(`DELETE FROM fornecedores WHERE id = ?`, [id], function (err) {
            if (err) return handleDBError(res, err);
            res.json({ message: "Fornecedor eliminado com sucesso" });
        });
    });
});

app.get('/api/clientes', authenticateJWT, isAdmin, (req, res) => {
    db.all(`SELECT * FROM clientes`, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/clientes', authenticateJWT, isAdmin, (req, res) => {
    let { nome, telefone, email, morada, NIF, manutencao_automatica, manutencao_periodo, manutencao_data_inicio } = req.body;

    nome = sanitizeString(nome);
    telefone = sanitizeString(telefone, 15);
    email = sanitizeString(email, 255);
    morada = sanitizeString(morada, 500);
    NIF = sanitizeString(NIF, 9);
    
    const mntAuto = manutencao_automatica ? parseInt(manutencao_automatica) : 0;
    const mntPeriodo = ['mensal', 'trimestral', 'semestral'].includes(manutencao_periodo) ? manutencao_periodo : null;
    const mntDataInicio = manutencao_data_inicio || null;

    if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Formato de email inválido" });
    if (telefone && !/^[0-9]{9}$/.test(telefone)) return res.status(400).json({ error: "Telefone deve conter exatamente 9 dígitos numéricos" });
    if (NIF && !/^[0-9]{9}$/.test(NIF)) return res.status(400).json({ error: "NIF deve conter exatamente 9 dígitos numéricos" });

    db.run(`INSERT INTO clientes (nome, telefone, email, morada, NIF, manutencao_automatica, manutencao_periodo, manutencao_data_inicio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [nome, telefone, email, morada, NIF, mntAuto, mntPeriodo, mntDataInicio],
        function (err) {
            if (err) return handleDBError(res, err);
            const clientId = this.lastID;
            
            if (mntAuto === 1) {
                generateClientMaintenances(clientId, mntPeriodo, mntDataInicio);
            }

            res.status(201).json({ id: clientId, nome, telefone, email, morada, NIF, manutencao_automatica: mntAuto, manutencao_periodo: mntPeriodo, manutencao_data_inicio: mntDataInicio });
        });
});

app.put('/api/clientes/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    let { nome, telefone, email, morada, NIF, manutencao_automatica, manutencao_periodo, manutencao_data_inicio } = req.body;

    nome = sanitizeString(nome);
    telefone = sanitizeString(telefone, 15);
    email = sanitizeString(email, 255);
    morada = sanitizeString(morada, 500);
    NIF = sanitizeString(NIF, 9);
    
    const mntAuto = manutencao_automatica ? parseInt(manutencao_automatica) : 0;
    const mntPeriodo = ['mensal', 'trimestral', 'semestral'].includes(manutencao_periodo) ? manutencao_periodo : null;
    const mntDataInicio = manutencao_data_inicio || null;

    if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Formato de email inválido" });
    if (telefone && !/^[0-9]{9}$/.test(telefone)) return res.status(400).json({ error: "Telefone deve conter exatamente 9 dígitos numéricos" });
    if (NIF && !/^[0-9]{9}$/.test(NIF)) return res.status(400).json({ error: "NIF deve conter exatamente 9 dígitos numéricos" });

    db.run(`UPDATE clientes SET nome = ?, telefone = ?, email = ?, morada = ?, NIF = ?, manutencao_automatica = ?, manutencao_periodo = ?, manutencao_data_inicio = ? WHERE id = ?`,
        [nome, telefone, email, morada, NIF, mntAuto, mntPeriodo, mntDataInicio, id],
        function (err) {
            if (err) return handleDBError(res, err);
            
            regenerateClientAutoMaintenances(id, (err) => {
                if (err) console.error('[SCHEDULE ERROR] Error during auto maintenance regeneration:', err);
                res.json({ message: "Cliente atualizado com sucesso", id, nome, telefone, email, morada, NIF, manutencao_automatica: mntAuto, manutencao_periodo: mntPeriodo, manutencao_data_inicio: mntDataInicio });
            });
        });
});

app.delete('/api/clientes/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM clientes WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        res.json({ message: "Cliente removido com sucesso", id });
    });
});

// --- Admin Report Editing ---

app.put('/api/admin/avarias/:id/relatorio', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { relatorio, pecas_substituidas, horas_trabalho, assinatura_cliente, assinatura_tecnico, deslocacoes } = req.body;

    const horasNum = (horas_trabalho !== null && horas_trabalho !== '') ? parseFloat(String(horas_trabalho).replace(',', '.')) : null;
    const deslocacoesNum = (deslocacoes !== null && deslocacoes !== undefined && deslocacoes !== '') ? parseInt(deslocacoes) : 1;

    db.get(`
        SELECT a.pecas_substituidas, m.cliente_id
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        WHERE a.id = ?
    `, [id], (err, row) => {
        if (err) return handleDBError(res, err);
        const oldPecas = row ? row.pecas_substituidas : '';
        const clienteId = row ? row.cliente_id : null;

        const metadata = {
            userId: req.user.id,
            userRole: 'admin',
            refId: id,
            tipoMovimento: 'ajuste_avaria',
            clienteId: clienteId
        };

        adjustStockFromReportPartsDifference(oldPecas, pecas_substituidas, metadata, (adjustErr) => {
            if (adjustErr) return handleStockOrDBError(res, adjustErr);

            db.run(`UPDATE avarias SET relatorio = ?, pecas_substituidas = ?, horas_trabalho = ?, assinatura_cliente = ?, assinatura_tecnico = ?, deslocacoes = ? WHERE id = ?`,
                [relatorio, pecas_substituidas, horasNum, assinatura_cliente, assinatura_tecnico, deslocacoesNum, id], function (err) {
                    if (err) return handleDBError(res, err);
                    securityLog('ADMIN_EDIT_REPORT', { type: 'avaria', id, admin_id: req.user.id });
                    res.json({ message: "Relatório atualizado pelo administrador" });
                });
        });
    });
});

app.put('/api/admin/servicos/:id/relatorio', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { relatorio, pecas_substituidas, horas_trabalho, assinatura_cliente, assinatura_tecnico, deslocacoes } = req.body;

    const horasNum = (horas_trabalho !== null && horas_trabalho !== '') ? parseFloat(String(horas_trabalho).replace(',', '.')) : null;
    const deslocacoesNum = (deslocacoes !== null && deslocacoes !== undefined && deslocacoes !== '') ? parseInt(deslocacoes) : 1;

    db.get(`SELECT pecas_substituidas, cliente_id FROM servicos WHERE id = ?`, [id], (err, row) => {
        if (err) return handleDBError(res, err);
        const oldPecas = row ? row.pecas_substituidas : '';
        const clienteId = row ? row.cliente_id : null;

        const metadata = {
            userId: req.user.id,
            userRole: 'admin',
            refId: id,
            tipoMovimento: 'ajuste_servico',
            clienteId: clienteId
        };

        adjustStockFromReportPartsDifference(oldPecas, pecas_substituidas, metadata, (adjustErr) => {
            if (adjustErr) return handleStockOrDBError(res, adjustErr);

            db.run(`UPDATE servicos SET relatorio = ?, pecas_substituidas = ?, horas_trabalho = ?, assinatura_cliente = ?, assinatura_tecnico = ?, deslocacoes = ? WHERE id = ?`,
                [relatorio, pecas_substituidas, horasNum, assinatura_cliente, assinatura_tecnico, deslocacoesNum, id], function (err) {
                    if (err) return handleDBError(res, err);
                    securityLog('ADMIN_EDIT_REPORT', { type: 'servico', id, admin_id: req.user.id });
                    res.json({ message: "Relatório atualizado pelo administrador" });
                });
        });
    });
});

app.put('/api/admin/manutencoes/:id/relatorio', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { relatorio, pecas_substituidas, horas_trabalho, assinatura_cliente, assinatura_tecnico, deslocacoes } = req.body;

    const horasNum = (horas_trabalho !== null && horas_trabalho !== '') ? parseFloat(String(horas_trabalho).replace(',', '.')) : null;
    const deslocacoesNum = (deslocacoes !== null && deslocacoes !== undefined && deslocacoes !== '') ? parseInt(deslocacoes) : 1;

    db.get(`SELECT pecas_substituidas, cliente_id FROM manutencoes WHERE id = ?`, [id], (err, row) => {
        if (err) return handleDBError(res, err);
        const oldPecas = row ? row.pecas_substituidas : '';
        const clienteId = row ? row.cliente_id : null;

        const metadata = {
            userId: req.user.id,
            userRole: 'admin',
            refId: id,
            tipoMovimento: 'ajuste_manutencao',
            clienteId: clienteId
        };

        adjustStockFromReportPartsDifference(oldPecas, pecas_substituidas, metadata, (adjustErr) => {
            if (adjustErr) return handleStockOrDBError(res, adjustErr);

            db.run(`UPDATE manutencoes SET relatorio = ?, pecas_substituidas = ?, horas_trabalho = ?, assinatura_cliente = ?, assinatura_tecnico = ?, deslocacoes = ? WHERE id = ?`,
                [relatorio, pecas_substituidas, horasNum, assinatura_cliente, assinatura_tecnico, deslocacoesNum, id], function (err) {
                    if (err) return handleDBError(res, err);
                    securityLog('ADMIN_EDIT_REPORT', { type: 'manutencao', id, admin_id: req.user.id });
                    res.json({ message: "Relatório atualizado pelo administrador" });
                });
        });
    });
});

// --- CLIENT USERS MANAGEMENT ---

app.get('/api/clientes/:id/users', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    // 🔒 CORREÇÃO: password_plain removido da query
    db.all(`SELECT id, nome, username, email FROM utilizadores_cliente WHERE cliente_id = ?`, [id], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/clientes/:id/users', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    let { nome, username, email, password } = req.body;

    nome = sanitizeString(nome);
    username = sanitizeString(username);
    email = sanitizeString(email);

    if (!nome || !username) {
        return res.status(400).json({ error: "Nome e Username são obrigatórios" });
    }

    const finalPassword = password || Math.floor(100000 + Math.random() * 900000).toString();
    const hashedPwd = bcrypt.hashSync(finalPassword, 10);

    // 🔒 CORREÇÃO: password_plain removida — não guardar password em texto claro
    db.run(`INSERT INTO utilizadores_cliente (cliente_id, nome, username, password, email) VALUES (?, ?, ?, ?, ?)`,
        [id, nome, username, hashedPwd, email],
        function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return res.status(400).json({ error: "Username já existe" });
                return handleDBError(res, err);
            }

            if (email) {
                sendClientCredentialsEmail(email, nome, username, finalPassword);
            }

            // Mostrar a password temporária uma única vez na resposta (para o admin partilhar com o utilizador)
            res.status(201).json({ id: this.lastID, message: "Utilizador criado com sucesso", tempPassword: finalPassword });
        });
});

app.put('/api/clientes-users/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    let { nome, username, email, password } = req.body;

    nome = sanitizeString(nome);
    username = sanitizeString(username);
    email = sanitizeString(email);

    if (password) {
        const hashedPwd = bcrypt.hashSync(password, 10);
        // 🔒 CORREÇÃO: password_plain removida
        db.run(`UPDATE utilizadores_cliente SET nome = ?, username = ?, email = ?, password = ? WHERE id = ?`,
            [nome, username, email, hashedPwd, id],
            function (err) {
                if (err) return handleDBError(res, err);
                res.json({ message: "Utilizador atualizado" });
            });
    } else {
        db.run(`UPDATE utilizadores_cliente SET nome = ?, username = ?, email = ? WHERE id = ?`,
            [nome, username, email, id],
            function (err) {
                if (err) return handleDBError(res, err);
                res.json({ message: "Utilizador atualizado" });
            });
    }
});

app.delete('/api/clientes-users/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM utilizadores_cliente WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        res.json({ message: "Utilizador removido" });
    });
});

app.get('/api/maquinas', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT m.id, m.marca, m.modelo, m.numero_serie, m.data_instalacao, m.data_inicio_garantia, m.data_fim_garantia, m.uuid, strftime('%Y-%m-%dT%H:%M:%SZ', m.data_criacao) as data_criacao, c.nome as cliente_nome, c.id as cliente_id, m.fornecedor, m.fatura_compra 
        FROM maquinas m 
        LEFT JOIN clientes c ON m.cliente_id = c.id
        ORDER BY m.id DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/maquinas', authenticateJWT, isAdmin, (req, res) => {
    const { cliente_id, data_instalacao, data_inicio_garantia, data_fim_garantia } = req.body;
    let { marca, modelo, numero_serie, fornecedor, fatura_compra } = req.body;

    marca = sanitizeString(marca);
    modelo = sanitizeString(modelo);
    numero_serie = sanitizeString(numero_serie);
    fornecedor = sanitizeString(fornecedor);
    fatura_compra = sanitizeString(fatura_compra);

    if (!cliente_id || !marca || !modelo) return res.status(400).json({ error: "Cliente, Marca e Modelo são obrigatórios" });

    const uuid = crypto.randomUUID();

    db.run(`INSERT INTO maquinas (cliente_id, marca, modelo, numero_serie, data_instalacao, data_inicio_garantia, data_fim_garantia, uuid, fornecedor, fatura_compra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [cliente_id, marca, modelo, numero_serie, data_instalacao, data_inicio_garantia, data_fim_garantia, uuid, fornecedor || null, fatura_compra || null],
        function (err) {
            if (err) return handleDBError(res, err);
            res.status(201).json({ id: this.lastID, cliente_id, marca, modelo, uuid, fornecedor: fornecedor || null, fatura_compra: fatura_compra || null });
        });
});

app.put('/api/maquinas/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { cliente_id, data_instalacao, data_inicio_garantia, data_fim_garantia } = req.body;
    let { marca, modelo, numero_serie, fornecedor, fatura_compra } = req.body;

    marca = sanitizeString(marca);
    modelo = sanitizeString(modelo);
    numero_serie = sanitizeString(numero_serie);
    fornecedor = sanitizeString(fornecedor);
    fatura_compra = sanitizeString(fatura_compra);

    if (!cliente_id || !marca || !modelo) return res.status(400).json({ error: "Cliente, Marca e Modelo são obrigatórios" });

    db.run(`UPDATE maquinas SET cliente_id = ?, marca = ?, modelo = ?, numero_serie = ?, data_instalacao = ?, data_inicio_garantia = ?, data_fim_garantia = ?, fornecedor = ?, fatura_compra = ? WHERE id = ?`,
        [cliente_id, marca, modelo, numero_serie, data_instalacao, data_inicio_garantia, data_fim_garantia, fornecedor || null, fatura_compra || null, id],
        function (err) {
            if (err) return handleDBError(res, err);
            res.json({ message: "Máquina atualizada com sucesso", id, cliente_id, marca, modelo, fornecedor: fornecedor || null, fatura_compra: fatura_compra || null });
        });
});

app.delete('/api/maquinas/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM maquinas WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        res.json({ message: "Máquina removida com sucesso", id });
    });
});

// --- GESTÃO DE COMPONENTES DA MÁQUINA ---

app.get('/api/componentes_maquina/modelo/:modelo', authenticateJWT, isAdmin, (req, res) => {
    const { modelo } = req.params;
    db.all(`SELECT * FROM componentes_maquina WHERE modelo_maquina = ? ORDER BY id ASC`, [modelo], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/componentes_maquina', authenticateJWT, isAdmin, (req, res) => {
    let { modelo_maquina, referencia, nome, fornecedor } = req.body;
    modelo_maquina = sanitizeString(modelo_maquina);
    referencia = sanitizeString(referencia);
    nome = sanitizeString(nome);
    fornecedor = sanitizeString(fornecedor);

    if (!modelo_maquina || !referencia || !nome || !fornecedor) {
        return res.status(400).json({ error: "Modelo, Referência, Nome e Fornecedor são obrigatórios" });
    }

    // Verify if supplier exists in 'fornecedores' table
    db.get(`SELECT id FROM fornecedores WHERE nome = ?`, [fornecedor], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) {
            return res.status(400).json({ error: `O fornecedor "${fornecedor}" não existe na lista de fornecedores.` });
        }

        db.run(
            `INSERT INTO componentes_maquina (modelo_maquina, referencia, nome, fornecedor) VALUES (?, ?, ?, ?)`,
            [modelo_maquina, referencia, nome, fornecedor],
            function (err) {
                if (err) return handleDBError(res, err);
                res.status(201).json({
                    id: this.lastID,
                    modelo_maquina,
                    referencia,
                    nome,
                    fornecedor
                });
            }
        );
    });
});

app.put('/api/componentes_maquina/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    let { referencia, nome, fornecedor } = req.body;
    referencia = sanitizeString(referencia);
    nome = sanitizeString(nome);
    fornecedor = sanitizeString(fornecedor);

    if (!referencia || !nome || !fornecedor) {
        return res.status(400).json({ error: "Referência, Nome e Fornecedor são obrigatórios" });
    }

    // Verify if supplier exists in 'fornecedores' table
    db.get(`SELECT id FROM fornecedores WHERE nome = ?`, [fornecedor], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) {
            return res.status(400).json({ error: `O fornecedor "${fornecedor}" não existe na lista de fornecedores.` });
        }

        db.run(
            `UPDATE componentes_maquina SET referencia = ?, nome = ?, fornecedor = ? WHERE id = ?`,
            [referencia, nome, fornecedor, id],
            function (err) {
                if (err) return handleDBError(res, err);
                res.json({ message: "Componente atualizado com sucesso" });
            }
        );
    });
});

app.delete('/api/componentes_maquina/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM componentes_maquina WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        res.json({ message: "Componente removido com sucesso" });
    });
});

// --- GESTÃO DE STOCK DE MÁQUINAS ---

app.get('/api/stock_maquinas', authenticateJWT, isAdmin, (req, res) => {
    db.all(`SELECT *, strftime('%Y-%m-%dT%H:%M:%SZ', data_entrada) as data_entrada FROM stock_maquinas ORDER BY id DESC`, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/stock_maquinas', authenticateJWT, isAdmin, (req, res) => {
    let { marca, modelo, numero_serie, fornecedor, fatura_compra } = req.body;
    marca = sanitizeString(marca);
    modelo = sanitizeString(modelo);
    numero_serie = sanitizeString(numero_serie);
    fornecedor = sanitizeString(fornecedor);
    fatura_compra = sanitizeString(fatura_compra);

    if (!marca || !modelo) return res.status(400).json({ error: "Marca e Modelo são obrigatórios" });

    const uuid = crypto.randomUUID();

    db.run(
        `INSERT INTO stock_maquinas (marca, modelo, numero_serie, fornecedor, fatura_compra, uuid) VALUES (?, ?, ?, ?, ?, ?)`,
        [marca, modelo, numero_serie || null, fornecedor || null, fatura_compra || null, uuid],
        function (err) {
            if (err) return handleDBError(res, err);
            res.status(201).json({
                id: this.lastID,
                marca,
                modelo,
                numero_serie: numero_serie || null,
                fornecedor: fornecedor || null,
                fatura_compra: fatura_compra || null,
                uuid: uuid
            });
        }
    );
});

app.put('/api/stock_maquinas/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    let { marca, modelo, numero_serie, fornecedor, fatura_compra } = req.body;
    marca = sanitizeString(marca);
    modelo = sanitizeString(modelo);
    numero_serie = sanitizeString(numero_serie);
    fornecedor = sanitizeString(fornecedor);
    fatura_compra = sanitizeString(fatura_compra);

    if (!marca || !modelo) return res.status(400).json({ error: "Marca e Modelo são obrigatórios" });

    db.run(
        `UPDATE stock_maquinas SET marca = ?, modelo = ?, numero_serie = ?, fornecedor = ?, fatura_compra = ? WHERE id = ?`,
        [marca, modelo, numero_serie || null, fornecedor || null, fatura_compra || null, id],
        function (err) {
            if (err) return handleDBError(res, err);
            res.json({ message: "Máquina em stock atualizada com sucesso" });
        }
    );
});

app.delete('/api/stock_maquinas/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM stock_maquinas WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        res.json({ message: "Máquina removida do stock com sucesso" });
    });
});

app.post('/api/stock_maquinas/:id/associar', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { cliente_id, data_instalacao, data_inicio_garantia, data_fim_garantia } = req.body;
    let { numero_serie } = req.body;
    numero_serie = sanitizeString(numero_serie);

    if (!cliente_id) return res.status(400).json({ error: "Cliente é obrigatório para associação" });

    // 1. Get stock machine details
    db.get(`SELECT * FROM stock_maquinas WHERE id = ?`, [id], (err, stockMachine) => {
        if (err) return handleDBError(res, err);
        if (!stockMachine) return res.status(404).json({ error: "Máquina em stock não encontrada" });

        const finalNumeroSerie = numero_serie || stockMachine.numero_serie;
        const uuid = stockMachine.uuid || crypto.randomUUID();

        // 2. Insert into maquinas
        db.run(
            `INSERT INTO maquinas (cliente_id, marca, modelo, numero_serie, data_instalacao, data_inicio_garantia, data_fim_garantia, uuid, fornecedor, fatura_compra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [cliente_id, stockMachine.marca, stockMachine.modelo, finalNumeroSerie || null, data_instalacao || null, data_inicio_garantia || null, data_fim_garantia || null, uuid, stockMachine.fornecedor || null, stockMachine.fatura_compra || null],
            function (err) {
                if (err) return handleDBError(res, err);

                // 3. Delete from stock_maquinas
                db.run(`DELETE FROM stock_maquinas WHERE id = ?`, [id], function (err) {
                    if (err) return handleDBError(res, err);
                    res.json({ message: "Máquina associada com sucesso e removida do stock", uuid });
                });
            }
        );
    });
});

app.get('/api/maquinas/:uuid/qrcode', authenticateJWT, isAdmin, async (req, res) => {
    const { uuid } = req.params;

    if (!isValidUUID(uuid)) {
        return res.status(400).json({ error: "UUID inválido" });
    }

    const host = req.get('host');
    const protocol = req.protocol;
    const reportUrl = `${protocol}://${host}/report.html?machine=${uuid}`;

    try {
        const qrCodeDataUrl = await qrcode.toDataURL(reportUrl);
        res.json({ qrCode: qrCodeDataUrl, url: reportUrl });
    } catch (err) {
        res.status(500).json({ error: "Failed to generate QR Code" });
    }
});

app.post('/api/maquinas/gerar-qrcode', authenticateJWT, isAdmin, async (req, res) => {
    const { maquina_id } = req.body;

    if (!isValidUUID(maquina_id)) {
        return res.status(400).json({ error: "UUID inválido" });
    }

    db.get(`SELECT * FROM maquinas WHERE uuid = ?`, [maquina_id], async (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Máquina não encontrada" });

        const host = req.get('host');
        const protocol = req.protocol;
        const url = `${protocol}://${host}/report.html?machine=${maquina_id}`;

        try {
            const qrCode = await qrcode.toDataURL(url);
            res.json({ qrCode, url });
        } catch (err) {
            res.status(500).json({ error: "Erro ao gerar QR Code" });
        }
    });
});

app.get('/api/avarias', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT a.id, a.maquina_id, a.tipo_avaria, a.estado, a.estado_faturacao, a.numero_fatura,
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora) as data_hora, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_fim) as data_hora_fim, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_pausa) as data_hora_pausa, 
               a.data_agendada,
               (SELECT group_concat(tecnico_id) FROM avaria_tecnicos WHERE avaria_id = a.id) as tecnico_id,
               a.notas,
               a.relatorio, a.relatorio_submetido, a.pecas_substituidas, a.horas_trabalho,
               a.assinatura_cliente,
               COALESCE(m.marca || ' - ' || m.modelo, 'Máquina Removida') as maquina_nome, 
               COALESCE(c.nome, 'Sem Cliente') as cliente_nome, 
               COALESCE((SELECT group_concat(t2.nome, ', ') FROM avaria_tecnicos at2 JOIN tecnicos t2 ON at2.tecnico_id = t2.id WHERE at2.avaria_id = a.id), 'Não Atribuído') as tecnico_nome
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        LEFT JOIN clientes c ON m.cliente_id = c.id
        WHERE a.arquivada = 0
        ORDER BY a.data_hora DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/avarias', authenticateJWT, isAdmin, (req, res) => {
    const { maquina_id, tipo_avaria, notas } = req.body;
    let tecnico_ids = req.body.tecnico_ids;
    if (!tecnico_ids && req.body.tecnico_id) {
        tecnico_ids = [req.body.tecnico_id];
    }
    if (!Array.isArray(tecnico_ids)) {
        tecnico_ids = [];
    }

    if (!maquina_id || !tipo_avaria) {
        return res.status(400).json({ error: "Máquina e tipo de avaria são obrigatórios" });
    }

    if (!isValidUUID(maquina_id)) {
        return res.status(400).json({ error: "Máquina selecionada é inválida ou não foi selecionada corretamente." });
    }

    if (!Number.isInteger(tipo_avaria) || tipo_avaria < 1 || tipo_avaria > 10) {
        return res.status(400).json({ error: "Tipo de avaria inválido" });
    }

    db.get(`SELECT (marca || ' - ' || modelo) as nome, cliente_id FROM maquinas WHERE uuid = ?`, [maquina_id], (err, machine) => {
        if (err) return handleDBError(res, err);
        if (!machine) return res.status(404).json({ error: "Máquina não encontrada" });

        const data_agendada = req.body.data_agendada || null;
        const main_tecnico_id = tecnico_ids.length > 0 ? tecnico_ids[0] : null;

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            db.run(`INSERT INTO avarias (maquina_id, tipo_avaria, tecnico_id, notas, data_agendada) VALUES (?, ?, ?, ?, ?)`,
                [maquina_id, tipo_avaria, main_tecnico_id, notas, data_agendada],
                function (err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return handleDBError(res, err);
                    }
                    const avariaId = this.lastID;

                    const stmt = db.prepare(`INSERT INTO avaria_tecnicos (avaria_id, tecnico_id) VALUES (?, ?)`);
                    tecnico_ids.forEach(tid => {
                        stmt.run(avariaId, tid);
                    });
                    stmt.finalize((err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return handleDBError(res, err);
                        }

                        db.run('COMMIT', (err) => {
                            if (err) return handleDBError(res, err);

                            securityLog('AVARIA_REPORTED_BY_ADMIN', { id: avariaId, maquina_id, tecnico_ids });

                            if (tecnico_ids.length > 0) {
                                db.all(`SELECT nome, email FROM tecnicos WHERE id IN (${tecnico_ids.map(() => '?').join(',')})`, tecnico_ids, (err, techs) => {
                                    if (!err && techs) {
                                        db.get(`SELECT nome FROM clientes WHERE id = ?`, [machine.cliente_id], (err, client) => {
                                            if (!err && client) {
                                                techs.forEach(t => {
                                                    if (t.email) {
                                                        sendAssignmentEmail(t.email, t.nome, machine.nome, client.nome, notas, 'avaria');
                                                    }
                                                });
                                            }
                                        });
                                    }
                                });
                            }

                            res.status(201).json({ id: avariaId, message: "Avaria reportada e atribuída" });
                        });
                    });
                }
            );
        });
    });
});

app.put('/api/avarias/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { maquina_id, tipo_avaria, notas, data_agendada } = req.body;
    let tecnico_ids = req.body.tecnico_ids;
    if (!tecnico_ids && req.body.tecnico_id) {
        tecnico_ids = [req.body.tecnico_id];
    }
    if (!Array.isArray(tecnico_ids)) {
        tecnico_ids = [];
    }

    if (!maquina_id || !tipo_avaria) {
        return res.status(400).json({ error: "Máquina e tipo de avaria são obrigatórios" });
    }

    if (!isValidUUID(maquina_id)) {
        return res.status(400).json({ error: "Máquina selecionada é inválida." });
    }

    db.get('SELECT estado FROM avarias WHERE id = ?', [id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Avaria não encontrada" });
        if (row.estado !== 'pendente') {
            return res.status(400).json({ error: "Apenas avarias pendentes podem ser editadas." });
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            const main_tecnico_id = tecnico_ids.length > 0 ? tecnico_ids[0] : null;

            db.run(`UPDATE avarias SET maquina_id = ?, tipo_avaria = ?, tecnico_id = ?, notas = ?, data_agendada = ? WHERE id = ?`,
                [maquina_id, tipo_avaria, main_tecnico_id, notas, data_agendada || null, id],
                function (err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return handleDBError(res, err);
                    }

                    db.run('DELETE FROM avaria_tecnicos WHERE avaria_id = ?', [id], (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return handleDBError(res, err);
                        }

                        const stmt = db.prepare(`INSERT INTO avaria_tecnicos (avaria_id, tecnico_id) VALUES (?, ?)`);
                        tecnico_ids.forEach(tid => {
                            stmt.run(id, tid);
                        });
                        stmt.finalize((err) => {
                            if (err) {
                                db.run('ROLLBACK');
                                return handleDBError(res, err);
                            }

                            db.run('COMMIT', (err) => {
                                if (err) return handleDBError(res, err);
                                securityLog('AVARIA_UPDATED_BY_ADMIN', { id, maquina_id, tecnico_ids });
                                res.json({ message: "Avaria atualizada com sucesso" });
                            });
                        });
                    });
                }
            );
        });
    });
});

app.put('/api/avarias/:id/arquivar', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE avarias SET arquivada = 1 WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        res.json({ message: "Avaria arquivada", id });
    });
});

app.put('/api/avarias/:id/agendamento', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { data_agendada, notas } = req.body;
    let tecnico_ids = req.body.tecnico_ids;
    if (!tecnico_ids && req.body.tecnico_id) {
        tecnico_ids = [req.body.tecnico_id];
    }
    if (!Array.isArray(tecnico_ids)) {
        tecnico_ids = [];
    }

    const main_tecnico_id = tecnico_ids.length > 0 ? tecnico_ids[0] : null;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run(`UPDATE avarias SET data_agendada = ?, notas = ?, tecnico_id = ? WHERE id = ?`,
            [data_agendada || null, notas, main_tecnico_id, id], function (err) {
                if (err) {
                    db.run('ROLLBACK');
                    return handleDBError(res, err);
                }

                db.run(`DELETE FROM avaria_tecnicos WHERE avaria_id = ?`, [id], function (err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return handleDBError(res, err);
                    }

                    if (tecnico_ids.length === 0) {
                        db.run('COMMIT', (err) => {
                            if (err) return handleDBError(res, err);
                            securityLog('AVARIA_AGENDAMENTO_EDITED', { avaria_id: id, tecnico_ids });
                            res.json({ message: "Agendamento da avaria updated" });
                        });
                        return;
                    }

                    const stmt = db.prepare(`INSERT INTO avaria_tecnicos (avaria_id, tecnico_id) VALUES (?, ?)`);
                    tecnico_ids.forEach(tid => {
                        stmt.run(id, tid);
                    });
                    stmt.finalize((err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return handleDBError(res, err);
                        }

                        db.run('COMMIT', (err) => {
                            if (err) return handleDBError(res, err);
                            securityLog('AVARIA_AGENDAMENTO_EDITED', { avaria_id: id, tecnico_ids });
                            res.json({ message: "Agendamento da avaria atualizado com sucesso" });
                        });
                    });
                });
            });
    });
});

app.put('/api/avarias/:id/atribuir', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    let tecnico_ids = req.body.tecnico_ids;
    if (!tecnico_ids && req.body.tecnico_id) {
        tecnico_ids = [req.body.tecnico_id];
    }
    if (!Array.isArray(tecnico_ids) || tecnico_ids.length === 0) {
        return res.status(400).json({ error: "IDs dos técnicos são obrigatórios" });
    }

    db.all(`SELECT id, nome, email FROM tecnicos WHERE id IN (${tecnico_ids.map(() => '?').join(',')})`, tecnico_ids, (err, techs) => {
        if (err) return handleDBError(res, err);
        if (!techs || techs.length === 0) return res.status(404).json({ error: "Nenhum técnico encontrado" });

        const avariaQuery = `
            SELECT (m.marca || ' - ' || m.modelo) as maquina_nome, c.nome as cliente_nome, a.notas
            FROM avarias a
            LEFT JOIN maquinas m ON a.maquina_id = m.uuid
            LEFT JOIN clientes c ON m.cliente_id = c.id
            WHERE a.id = ?
        `;

        db.get(avariaQuery, [id], (err, avaria) => {
            if (err) return handleDBError(res, err);

            const main_tecnico_id = tecnico_ids[0];

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                db.run(`UPDATE avarias SET tecnico_id = ? WHERE id = ?`, [main_tecnico_id, id], function (err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return handleDBError(res, err);
                    }

                    db.run(`DELETE FROM avaria_tecnicos WHERE avaria_id = ?`, [id], function (err) {
                        if (err) {
                            db.run('ROLLBACK');
                            return handleDBError(res, err);
                        }

                        const stmt = db.prepare(`INSERT INTO avaria_tecnicos (avaria_id, tecnico_id) VALUES (?, ?)`);
                        tecnico_ids.forEach(tid => {
                            stmt.run(id, tid);
                        });
                        stmt.finalize((err) => {
                            if (err) {
                                db.run('ROLLBACK');
                                return handleDBError(res, err);
                            }

                            db.run('COMMIT', (err) => {
                                if (err) return handleDBError(res, err);

                                securityLog('AVARIA_ATRIBUIDA', { avaria_id: id, tecnico_ids });

                                if (avaria) {
                                    techs.forEach(t => {
                                        if (t.email) {
                                            sendAssignmentEmail(t.email, t.nome, avaria.maquina_nome, avaria.cliente_nome, avaria.notas, 'avaria');
                                        }
                                    });
                                }

                                res.json({ message: "Técnicos atribuídos com sucesso", id, tecnico_ids });
                            });
                        });
                    });
                });
            });
        });
    });
});

app.put('/api/avarias/:id/status', authenticateJWT, isAdminOrTecnico, (req, res) => {
    const { id } = req.params;
    const { estado, relatorio } = req.body;

    if (!['pendente', 'em resolução', 'resolvida', 'pausada'].includes(estado)) {
        return res.status(400).json({ error: "Estado inválido" });
    }

    let query;
    let params = [estado];

    if (estado === 'em resolução') {
        query = `UPDATE avarias SET estado = ?, data_hora_inicio = CURRENT_TIMESTAMP WHERE id = ?`;
        params.push(id);
    } else if (estado === 'resolvida') {
        if (relatorio) {
            query = `UPDATE avarias SET estado = ?, data_hora_fim = CURRENT_TIMESTAMP, relatorio = ?, 
                     tempo_acumulado = COALESCE(tempo_acumulado, 0) + (CASE WHEN estado = 'em resolução' THEN CAST((strftime('%s', 'now') - strftime('%s', COALESCE(data_hora_inicio, 'now'))) AS INTEGER) ELSE 0 END),
                     horas_trabalho = (COALESCE(tempo_acumulado, 0) + (CASE WHEN estado = 'em resolução' THEN CAST((strftime('%s', 'now') - strftime('%s', COALESCE(data_hora_inicio, 'now'))) AS INTEGER) ELSE 0 END)) / 3600.0
                     WHERE id = ?`;
            params.push(relatorio, id);
        } else {
            query = `UPDATE avarias SET estado = ?, data_hora_fim = CURRENT_TIMESTAMP, 
                     tempo_acumulado = COALESCE(tempo_acumulado, 0) + (CASE WHEN estado = 'em resolução' THEN CAST((strftime('%s', 'now') - strftime('%s', COALESCE(data_hora_inicio, 'now'))) AS INTEGER) ELSE 0 END),
                     horas_trabalho = (COALESCE(tempo_acumulado, 0) + (CASE WHEN estado = 'em resolução' THEN CAST((strftime('%s', 'now') - strftime('%s', COALESCE(data_hora_inicio, 'now'))) AS INTEGER) ELSE 0 END)) / 3600.0
                     WHERE id = ?`;
            params.push(id);
        }
    } else if (estado === 'pausada') {
        if (req.body.motivo_pausa) {
            query = `UPDATE avarias SET estado = ?, relatorio = COALESCE(relatorio || '\n\n', '') || ?, tempo_acumulado = COALESCE(tempo_acumulado, 0) + CAST((strftime('%s', 'now') - strftime('%s', COALESCE(data_hora_inicio, 'now'))) AS INTEGER), data_hora_pausa = CURRENT_TIMESTAMP WHERE id = ?`;
            const dataS = new Date().toLocaleString('pt-PT');
            const stamp = `[Reparação Pausada em ${dataS}]: ${req.body.motivo_pausa}`;
            params.push(stamp, id);
        } else {
            query = `UPDATE avarias SET estado = ?, tempo_acumulado = COALESCE(tempo_acumulado, 0) + CAST((strftime('%s', 'now') - strftime('%s', COALESCE(data_hora_inicio, 'now'))) AS INTEGER), data_hora_pausa = CURRENT_TIMESTAMP WHERE id = ?`;
            params.push(id);
        }
    } else {
        query = `UPDATE avarias SET estado = ? WHERE id = ?`;
        params.push(id);
    }

    db.run(query, params, function (err) {
        if (err) return handleDBError(res, err);
        securityLog('AVARIA_STATUS_CHANGED', { avaria_id: id, new_status: estado, user: req.user.id });
        res.json({ message: "Estado atualizado com sucesso", id, estado });
    });
});

// Salvar rascunho de relatório de avaria
app.put('/api/tecnico/avarias/:id/relatorio', authenticateJWT, isTecnico, (req, res) => {
    const { id } = req.params;
    const { relatorio, pecas_substituidas, horas_trabalho, assinatura_cliente, assinatura_tecnico, deslocacoes, preparativos } = req.body;
    const techId = req.user.id;

    db.get(`SELECT relatorio_submetido, EXISTS (SELECT 1 FROM avaria_tecnicos WHERE avaria_id = a.id AND tecnico_id = ?) as is_assigned FROM avarias a WHERE a.id = ?`, [techId, id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Avaria não encontrada" });
        if (!row.is_assigned) return res.status(403).json({ error: "Acesso negado" });
        if (row.relatorio_submetido === 1) return res.status(400).json({ error: "Relatório já foi submetido e não pode ser editado." });

        const horasNum = (horas_trabalho !== null && horas_trabalho !== '') ? parseFloat(String(horas_trabalho).replace(',', '.')) : null;
        const deslocacoesNum = (deslocacoes !== null && deslocacoes !== undefined && deslocacoes !== '') ? parseInt(deslocacoes) : 1;

        db.run(`UPDATE avarias SET relatorio = ?, pecas_substituidas = ?, horas_trabalho = ?, assinatura_cliente = ?, assinatura_tecnico = ?, deslocacoes = ? WHERE id = ?`,
            [relatorio, pecas_substituidas, horasNum, assinatura_cliente, assinatura_tecnico, deslocacoesNum, id], function (err) {
                if (err) return handleDBError(res, err);

                if (preparativos && preparativos.length > 0) {
                    db.serialize(() => {
                        let prepErr = null;
                        let prepCompleted = 0;
                        const updatePrepStmt = db.prepare(`UPDATE preparativos_avaria SET quantidade_usada = ? WHERE avaria_id = ? AND produto_id = ?`);
                        
                        preparativos.forEach(p => {
                            const qty = parseFloat(p.quantidade_usada);
                            updatePrepStmt.run(qty, id, p.produto_id, (err) => {
                                if (err) prepErr = err;
                                prepCompleted++;
                                if (prepCompleted === preparativos.length) {
                                    updatePrepStmt.finalize();
                                    if (prepErr) return handleDBError(res, prepErr);
                                    res.json({ message: "Rascunho salvo com sucesso" });
                                }
                            });
                        });
                    });
                } else {
                    res.json({ message: "Rascunho salvo com sucesso" });
                }
            });
    });
});

// Submeter relatório de avaria
app.post('/api/tecnico/avarias/:id/submeter-relatorio', authenticateJWT, isTecnico, (req, res) => {
    const { id } = req.params;
    const techId = req.user.id;

    db.get(`
        SELECT a.relatorio_submetido, a.pecas_substituidas, m.cliente_id,
               EXISTS (SELECT 1 FROM avaria_tecnicos WHERE avaria_id = a.id AND tecnico_id = ?) as is_assigned
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        WHERE a.id = ?
    `, [techId, id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Avaria não encontrada" });
        if (!row.is_assigned) return res.status(403).json({ error: "Acesso negado" });
        if (row.relatorio_submetido === 1) return res.status(400).json({ error: "Relatório já foi submetido." });

        const metadata = {
            userId: techId,
            userRole: 'tecnico',
            refId: id,
            tipoMovimento: 'consumo_avaria',
            clienteId: row.cliente_id
        };

        // 1. Processar devolução de peças preparadas não usadas
        db.all(`SELECT produto_id, quantidade_levada, quantidade_usada FROM preparativos_avaria WHERE avaria_id = ?`, [id], (err, preps) => {
            if (err) return handleDBError(res, err);

            db.serialize(() => {
                let devErr = null;
                let devCompleted = 0;

                const updateStockStmt = db.prepare(`UPDATE produto SET quantidade = quantidade + ? WHERE id = ?`);
                const insertMovStmt = db.prepare(`
                    INSERT INTO movimentos_stock (produto_id, quantidade, tipo_movimento, referencia_id, cliente_id, utilizador_id, utilizador_role, data_hora)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `);

                function finishDevolution() {
                    updateStockStmt.finalize();
                    insertMovStmt.finalize();
                    if (devErr) return handleDBError(res, devErr);

                    // 2. Deduzir outras peças do relatório e submeter
                    deductStockFromReportParts(row.pecas_substituidas, metadata, (deductErr) => {
                        if (deductErr) return handleStockOrDBError(res, deductErr);

                        db.run(`UPDATE avarias SET relatorio_submetido = 1 WHERE id = ?`, [id], function (err) {
                            if (err) return handleDBError(res, err);
                            securityLog('RELATORIO_SUBMETIDO', { avaria_id: id, tecnico_id: techId });
                            res.json({ message: "Relatório submetido com sucesso." });
                        });
                    });
                }

                const itemsToDevolve = (preps || []).map(p => {
                    const levada = p.quantidade_levada || 0;
                    const usada = p.quantidade_usada || 0;
                    const devolver = levada - usada;
                    return { produto_id: p.produto_id, devolver };
                }).filter(x => x.devolver > 0);

                if (itemsToDevolve.length === 0) {
                    return finishDevolution();
                }

                itemsToDevolve.forEach(item => {
                    updateStockStmt.run(item.devolver, item.produto_id, (err) => {
                        if (err) {
                            devErr = err;
                            checkDoneDev();
                            return;
                        }

                        const dateStr = new Date().toISOString();
                        insertMovStmt.run(item.produto_id, item.devolver, 'devolucao_preparativos', id, row.cliente_id, techId, 'tecnico', dateStr, (err) => {
                            if (err) devErr = err;
                            checkDoneDev();
                        });
                    });
                });

                function checkDoneDev() {
                    devCompleted++;
                    if (devCompleted === itemsToDevolve.length) {
                        finishDevolution();
                    }
                }
            });
        });
    });
});

// Detalhes Completos do Relatório de avaria
app.get('/api/avarias/:id/detalhes-relatorio', authenticateJWT, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const { id } = req.params;
    const query = `
        SELECT a.*, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora) as data_hora,
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_inicio) as data_hora_inicio,
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_fim) as data_hora_fim,
               (m.marca || ' - ' || m.modelo) as maquina_nome, m.uuid as maquina_uuid,
               c.nome as cliente_nome, c.telefone as cliente_contato, c.email as cliente_email, c.NIF as cliente_nif,
               m.numero_serie as maquina_serie,
               (SELECT group_concat(tecnico_id) FROM avaria_tecnicos WHERE avaria_id = a.id) as tecnico_id,
               COALESCE((SELECT group_concat(t2.nome, ', ') FROM avaria_tecnicos at2 JOIN tecnicos t2 ON at2.tecnico_id = t2.id WHERE at2.avaria_id = a.id), 'Não Atribuído') as tecnico_nome
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        LEFT JOIN clientes c ON m.cliente_id = c.id
        WHERE a.id = ?
    `;

    db.get(query, [id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Intervenção não encontrada" });

        db.all(`SELECT id, caminho FROM fotos_relatorio WHERE avaria_id = ?`, [id], (err, fotos) => {
            if (err) return handleDBError(res, err);
            row.fotos = fotos || [];
            
            const prepQuery = `
                SELECT p.produto_id, p.quantidade_levada, p.quantidade_usada, pr.nome_produto, pr.unidade
                FROM preparativos_avaria p
                JOIN produto pr ON p.produto_id = pr.id
                WHERE p.avaria_id = ?
                ORDER BY pr.nome_produto ASC
            `;
            db.all(prepQuery, [id], (err, preparativos) => {
                if (err) return handleDBError(res, err);
                row.preparativos = preparativos || [];
                res.json(row);
            });
        });
    });
});

app.get('/api/estatisticas/avarias', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT a.id, a.tipo_avaria, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_fim) as data_hora_fim, 
               (SELECT group_concat(tecnico_id) FROM avaria_tecnicos WHERE avaria_id = a.id) as tecnico_id,
               COALESCE((SELECT group_concat(t2.nome, ', ') FROM avaria_tecnicos at2 JOIN tecnicos t2 ON at2.tecnico_id = t2.id WHERE at2.avaria_id = a.id), 'Não Atribuído') as tecnico_nome
        FROM avarias a
        WHERE a.estado = 'resolvida' AND a.data_hora_fim IS NOT NULL
        ORDER BY a.data_hora_fim ASC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/historico/avarias', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT a.id, a.maquina_id, a.tipo_avaria, a.estado, a.estado_faturacao,
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora) as data_hora, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_inicio) as data_hora_inicio, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_fim) as data_hora_fim, 
               (SELECT group_concat(tecnico_id) FROM avaria_tecnicos WHERE avaria_id = a.id) as tecnico_id,
               a.notas,
               a.relatorio, a.relatorio_submetido, a.pecas_substituidas, a.horas_trabalho,
               COALESCE(m.marca || ' - ' || m.modelo, 'Máquina Removida') as maquina_nome, m.uuid as maquina_uuid, 
               COALESCE(c.nome, 'Sem Cliente') as cliente_nome, c.id as cliente_id,
               COALESCE((SELECT group_concat(t2.nome, ', ') FROM avaria_tecnicos at2 JOIN tecnicos t2 ON at2.tecnico_id = t2.id WHERE at2.avaria_id = a.id), 'Não Atribuído') as tecnico_nome
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        LEFT JOIN clientes c ON m.cliente_id = c.id
        WHERE a.estado = 'resolvida'
        ORDER BY COALESCE(a.data_hora_fim, a.data_hora) DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

// Atualizar estado de faturação de avaria
app.put('/api/avarias/:id/faturacao', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { estado_faturacao, numero_fatura } = req.body;

    const allowed = ['Por Faturar', 'Para Faturar', 'Faturado', 'Oferta', 'Garantia'];
    if (!allowed.includes(estado_faturacao)) {
        return res.status(400).json({ error: "Estado de faturação inválido" });
    }

    db.run(`UPDATE avarias SET estado_faturacao = ?, numero_fatura = ? WHERE id = ?`, [estado_faturacao, numero_fatura || null, id], function (err) {
        if (err) return handleDBError(res, err);
        securityLog('AVARIA_FATURACAO_CHANGED', { avaria_id: id, novo_estado: estado_faturacao, numero_fatura });
        res.json({ message: "Estado de faturação atualizado com sucesso", id, estado_faturacao, numero_fatura });
    });
});

// Apagar avaria (Permanente)
app.delete('/api/avarias/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.serialize(() => {
        db.run(`DELETE FROM fotos_relatorio WHERE avaria_id = ?`, [id]);
        db.run(`DELETE FROM avarias WHERE id = ?`, [id], function (err) {
            if (err) return handleDBError(res, err);
            securityLog('AVARIA_DELETED', { avaria_id: id, admin_id: req.user.id });
            res.json({ message: "Avaria removida com sucesso" });
        });
    });
});


// --- SERVIÇOS ROUTES ---

app.get('/api/servicos', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT s.*, 
               COALESCE(c.nome, 'Sem Cliente') as cliente_nome, 
               (SELECT group_concat(tecnico_id) FROM servico_tecnicos WHERE servico_id = s.id) as tecnico_id,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora) as data_hora,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora_fim) as data_hora_fim,
               s.data_agendada,
               COALESCE((SELECT group_concat(t2.nome, ', ') FROM servico_tecnicos st2 JOIN tecnicos t2 ON st2.tecnico_id = t2.id WHERE st2.servico_id = s.id), 'Não Atribuído') as tecnico_nome
        FROM servicos s
        LEFT JOIN clientes c ON s.cliente_id = c.id
        WHERE s.arquivada = 0
        ORDER BY s.data_hora DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/servicos', authenticateJWT, isAdmin, (req, res) => {
    const { cliente_id, tipo_servico, tipo_camiao, notas, data_agendada, maquina_ids } = req.body;
    let tecnico_ids = req.body.tecnico_ids;
    if (!tecnico_ids && req.body.tecnico_id) {
        tecnico_ids = [req.body.tecnico_id];
    }
    if (!Array.isArray(tecnico_ids)) {
        tecnico_ids = [];
    }

    if (!cliente_id || !tipo_servico || !tipo_camiao) {
        return res.status(400).json({ error: "Cliente, Tipo de Serviço e Tipo de Transporte são obrigatórios" });
    }

    const main_tecnico_id = tecnico_ids.length > 0 ? tecnico_ids[0] : null;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        const query = `INSERT INTO servicos (cliente_id, tecnico_id, tipo_servico, tipo_camiao, notas, data_agendada) VALUES (?, ?, ?, ?, ?, ?)`;
        db.run(query, [cliente_id, main_tecnico_id, tipo_servico, tipo_camiao, notas, data_agendada || null], function (err) {
            if (err) {
                db.run('ROLLBACK');
                return handleDBError(res, err);
            }
            const serviceId = this.lastID;

            const insertTechs = () => {
                const stmt = db.prepare(`INSERT INTO servico_tecnicos (servico_id, tecnico_id) VALUES (?, ?)`);
                tecnico_ids.forEach(tid => {
                    stmt.run(serviceId, tid);
                });
                stmt.finalize((err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return handleDBError(res, err);
                    }

                    db.run('COMMIT', (err) => {
                        if (err) return handleDBError(res, err);

                        securityLog('SERVICE_REPORTED_BY_ADMIN', { id: serviceId, cliente_id, tecnico_ids });

                        if (tecnico_ids.length > 0) {
                            db.all(`SELECT nome, email FROM tecnicos WHERE id IN (${tecnico_ids.map(() => '?').join(',')})`, tecnico_ids, (err, techs) => {
                                if (!err && techs) {
                                    db.get(`SELECT nome FROM clientes WHERE id = ?`, [cliente_id], (err, client) => {
                                        if (!err && client) {
                                            techs.forEach(t => {
                                                if (t.email) {
                                                    sendAssignmentEmail(t.email, t.nome, `${tipo_servico} (${tipo_camiao})`, client.nome, notas, 'servico');
                                                }
                                            });
                                        }
                                    });
                                }
                            });
                        }

                        res.status(201).json({ id: serviceId, message: "Serviço reportado com sucesso" });
                    });
                });
            };

            if (Array.isArray(maquina_ids) && maquina_ids.length > 0) {
                const stmt = db.prepare(`INSERT INTO servico_maquinas (servico_id, maquina_id) VALUES (?, ?)`);
                let hasError = false;

                maquina_ids.forEach(mId => {
                    stmt.run(serviceId, mId, (err) => {
                        if (err) {
                            console.error('[DB ERROR] Error inserting service machine:', err);
                            hasError = true;
                        }
                    });
                });

                stmt.finalize((err) => {
                    if (err || hasError) {
                        db.run('ROLLBACK');
                        return handleDBError(res, err || new Error("Erro ao associar máquinas"));
                    }
                    insertTechs();
                });
            } else {
                insertTechs();
            }
        });
    });
});

app.put('/api/servicos/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { cliente_id, tipo_servico, tipo_camiao, notas, data_agendada, maquina_ids } = req.body;
    let tecnico_ids = req.body.tecnico_ids;
    if (!tecnico_ids && req.body.tecnico_id) {
        tecnico_ids = [req.body.tecnico_id];
    }
    if (!Array.isArray(tecnico_ids)) {
        tecnico_ids = [];
    }

    if (!cliente_id || !tipo_servico || !tipo_camiao) {
        return res.status(400).json({ error: "Cliente, Tipo de Serviço e Tipo de Transporte são obrigatórios" });
    }

    db.get('SELECT estado FROM servicos WHERE id = ?', [id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Serviço não encontrado" });
        if (row.estado !== 'pendente') {
            return res.status(400).json({ error: "Apenas serviços pendentes podem ser editados." });
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            const main_tecnico_id = tecnico_ids.length > 0 ? tecnico_ids[0] : null;

            db.run(`UPDATE servicos SET cliente_id = ?, tecnico_id = ?, tipo_servico = ?, tipo_camiao = ?, notas = ?, data_agendada = ? WHERE id = ?`,
                [cliente_id, main_tecnico_id, tipo_servico, tipo_camiao, notas, data_agendada || null, id],
                function (err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return handleDBError(res, err);
                    }

                    db.run('DELETE FROM servico_tecnicos WHERE servico_id = ?', [id], (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return handleDBError(res, err);
                        }

                        const insertTechs = () => {
                            const stmt = db.prepare(`INSERT INTO servico_tecnicos (servico_id, tecnico_id) VALUES (?, ?)`);
                            tecnico_ids.forEach(tid => {
                                stmt.run(id, tid);
                            });
                            stmt.finalize((err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return handleDBError(res, err);
                                }

                                db.run('COMMIT', (err) => {
                                    if (err) return handleDBError(res, err);
                                    securityLog('SERVICE_UPDATED_BY_ADMIN', { id, cliente_id, tecnico_ids });
                                    res.json({ message: "Serviço atualizado com sucesso" });
                                });
                            });
                        };

                        db.run('DELETE FROM servico_maquinas WHERE servico_id = ?', [id], (err) => {
                            if (err) {
                                db.run('ROLLBACK');
                                return handleDBError(res, err);
                            }

                            if (Array.isArray(maquina_ids) && maquina_ids.length > 0) {
                                const stmt = db.prepare(`INSERT INTO servico_maquinas (servico_id, maquina_id) VALUES (?, ?)`);
                                let hasError = false;

                                maquina_ids.forEach(mId => {
                                    stmt.run(id, mId, (err) => {
                                        if (err) {
                                            console.error('[DB ERROR] Error inserting service machine:', err);
                                            hasError = true;
                                        }
                                    });
                                });

                                stmt.finalize((err) => {
                                    if (err || hasError) {
                                        db.run('ROLLBACK');
                                        return handleDBError(res, err || new Error("Erro ao associar máquinas"));
                                    }
                                    insertTechs();
                                });
                            } else {
                                insertTechs();
                            }
                        });
                    });
                }
            );
        });
    });
});

app.put('/api/servicos/:id/atribuir', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    let tecnico_ids = req.body.tecnico_ids;
    if (!tecnico_ids && req.body.tecnico_id) {
        tecnico_ids = [req.body.tecnico_id];
    }
    if (!Array.isArray(tecnico_ids) || tecnico_ids.length === 0) {
        return res.status(400).json({ error: "IDs dos técnicos são obrigatórios" });
    }

    db.all(`SELECT id, nome, email FROM tecnicos WHERE id IN (${tecnico_ids.map(() => '?').join(',')})`, tecnico_ids, (err, techs) => {
        if (err) return handleDBError(res, err);
        if (!techs || techs.length === 0) return res.status(404).json({ error: "Nenhum técnico encontrado" });

        const main_tecnico_id = tecnico_ids[0];

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            db.run(`UPDATE servicos SET tecnico_id = ? WHERE id = ?`, [main_tecnico_id, id], function (err) {
                if (err) {
                    db.run('ROLLBACK');
                    return handleDBError(res, err);
                }

                db.run(`DELETE FROM servico_tecnicos WHERE servico_id = ?`, [id], function (err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return handleDBError(res, err);
                    }

                    const stmt = db.prepare(`INSERT INTO servico_tecnicos (servico_id, tecnico_id) VALUES (?, ?)`);
                    tecnico_ids.forEach(tid => {
                        stmt.run(id, tid);
                    });
                    stmt.finalize((err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return handleDBError(res, err);
                        }

                        db.run('COMMIT', (err) => {
                            if (err) return handleDBError(res, err);

                            db.get(`SELECT s.tipo_servico, s.tipo_camiao, s.notas, c.nome as cliente_nome 
                                   FROM servicos s JOIN clientes c ON s.cliente_id = c.id 
                                   WHERE s.id = ?`, [id], (err, srv) => {
                                if (!err && srv) {
                                    techs.forEach(t => {
                                        if (t.email) {
                                            sendAssignmentEmail(t.email, t.nome, `${srv.tipo_servico} (${srv.tipo_camiao})`, srv.cliente_nome, srv.notas, 'servico');
                                        }
                                    });
                                }
                            });

                            res.json({ message: "Técnicos atribuídos com sucesso", tecnico_ids });
                        });
                    });
                });
            });
        });
    });
});

app.put('/api/servicos/:id/status', authenticateJWT, isAdminOrTecnico, (req, res) => {
    const { id } = req.params;
    const { estado, relatorio } = req.body;

    if (!['pendente', 'em resolução', 'resolvida', 'pausada'].includes(estado)) {
        return res.status(400).json({ error: "Estado inválido" });
    }

    let query;
    let params = [estado];

    if (estado === 'em resolução') {
        query = `UPDATE servicos SET estado = ?, data_hora_inicio = CURRENT_TIMESTAMP WHERE id = ?`;
        params.push(id);
    } else if (estado === 'resolvida') {
        query = `UPDATE servicos SET estado = ?, data_hora_fim = CURRENT_TIMESTAMP, 
                 tempo_acumulado = COALESCE(tempo_acumulado, 0) + (CASE WHEN estado = 'em resolução' THEN CAST((strftime('%s', 'now') - strftime('%s', COALESCE(data_hora_inicio, 'now'))) AS INTEGER) ELSE 0 END),
                 horas_trabalho = (COALESCE(tempo_acumulado, 0) + (CASE WHEN estado = 'em resolução' THEN CAST((strftime('%s', 'now') - strftime('%s', COALESCE(data_hora_inicio, 'now'))) AS INTEGER) ELSE 0 END)) / 3600.0
                 ${relatorio ? ', relatorio = ?' : ''} WHERE id = ?`;
        if (relatorio) params.push(relatorio);
        params.push(id);
    } else if (estado === 'pausada') {
        query = `UPDATE servicos SET estado = ?, data_hora_pausa = CURRENT_TIMESTAMP,
                 tempo_acumulado = COALESCE(tempo_acumulado, 0) + CAST((strftime('%s', 'now') - strftime('%s', COALESCE(data_hora_inicio, 'now'))) AS INTEGER)
                 ${req.body.motivo_pausa ? ', relatorio = COALESCE(relatorio || \'\n\n\', \'\') || ?' : ''} WHERE id = ?`;
        if (req.body.motivo_pausa) {
            const stamp = `[Serviço Pausado em ${new Date().toLocaleString('pt-PT')}]: ${req.body.motivo_pausa}`;
            params.push(stamp);
        }
        params.push(id);
    } else {
        query = `UPDATE servicos SET estado = ? WHERE id = ?`;
        params.push(id);
    }

    db.run(query, params, function (err) {
        if (err) return handleDBError(res, err);
        securityLog('SERVICE_STATUS_CHANGED', { service_id: id, new_status: estado, user: req.user.id });
        res.json({ message: "Estado atualizado", id, estado });
    });
});

app.put('/api/servicos/:id/arquivar', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE servicos SET arquivada = 1 WHERE id = ?`, [id], (err) => {
        if (err) return handleDBError(res, err);
        res.json({ message: "Serviço arquivado" });
    });
});

app.put('/api/servicos/:id/agendamento', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { data_agendada, notas } = req.body;
    let tecnico_ids = req.body.tecnico_ids;
    if (!tecnico_ids && req.body.tecnico_id) {
        tecnico_ids = [req.body.tecnico_id];
    }
    if (!Array.isArray(tecnico_ids)) {
        tecnico_ids = [];
    }

    const main_tecnico_id = tecnico_ids.length > 0 ? tecnico_ids[0] : null;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run(`UPDATE servicos SET data_agendada = ?, notas = ?, tecnico_id = ? WHERE id = ?`,
            [data_agendada || null, notas, main_tecnico_id, id], function (err) {
                if (err) {
                    db.run('ROLLBACK');
                    return handleDBError(res, err);
                }

                db.run(`DELETE FROM servico_tecnicos WHERE servico_id = ?`, [id], function (err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return handleDBError(res, err);
                    }

                    if (tecnico_ids.length === 0) {
                        db.run('COMMIT', (err) => {
                            if (err) return handleDBError(res, err);
                            securityLog('SERVICO_AGENDAMENTO_EDITED', { servico_id: id, tecnico_ids });
                            res.json({ message: "Agendamento do serviço atualizado com sucesso" });
                        });
                        return;
                    }

                    const stmt = db.prepare(`INSERT INTO servico_tecnicos (servico_id, tecnico_id) VALUES (?, ?)`);
                    tecnico_ids.forEach(tid => {
                        stmt.run(id, tid);
                    });
                    stmt.finalize((err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return handleDBError(res, err);
                        }

                        db.run('COMMIT', (err) => {
                            if (err) return handleDBError(res, err);
                            securityLog('SERVICO_AGENDAMENTO_EDITED', { servico_id: id, tecnico_ids });
                            res.json({ message: "Agendamento do serviço atualizado com sucesso" });
                        });
                    });
                });
            });
    });
});

// 🔒 CORREÇÃO: Validação do estado de faturação de serviços
app.put('/api/servicos/:id/faturacao', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { estado_faturacao, numero_fatura } = req.body;

    const allowed = ['Por Faturar', 'Para Faturar', 'Faturado', 'Oferta', 'Garantia'];
    if (!allowed.includes(estado_faturacao)) {
        return res.status(400).json({ error: "Estado de faturação inválido" });
    }

    db.run(`UPDATE servicos SET estado_faturacao = ?, numero_fatura = ? WHERE id = ?`, [estado_faturacao, numero_fatura || null, id], function (err) {
        if (err) return handleDBError(res, err);
        securityLog('SERVICO_FATURACAO_CHANGED', { servico_id: id, novo_estado: estado_faturacao, numero_fatura });
        res.json({ message: "Estado de faturação atualizado com sucesso", id, estado_faturacao, numero_fatura });
    });
});

// Apagar serviço (Permanente)
app.delete('/api/servicos/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.serialize(() => {
        db.run(`DELETE FROM fotos_relatorio WHERE servico_id = ?`, [id]);
        db.run(`DELETE FROM servico_maquinas WHERE servico_id = ?`, [id]);
        db.run(`DELETE FROM servicos WHERE id = ?`, [id], function (err) {
            if (err) return handleDBError(res, err);
            securityLog('SERVICO_DELETED', { servico_id: id, admin_id: req.user.id });
            res.json({ message: "Serviço removido com sucesso" });
        });
    });
});


app.get('/api/tecnico/servicos', authenticateJWT, isTecnico, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const techId = req.user.id;
    const query = `
        SELECT s.*, c.nome as cliente_nome, c.morada as cliente_morada,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora) as data_hora,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora_inicio) as data_hora_inicio,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora_pausa) as data_hora_pausa
        FROM servicos s
        JOIN clientes c ON s.cliente_id = c.id
        WHERE EXISTS (SELECT 1 FROM servico_tecnicos WHERE servico_id = s.id AND tecnico_id = ?) 
          AND s.estado != 'resolvida' 
          AND s.arquivada = 0
          AND (s.data_agendada IS NULL OR datetime(s.data_agendada) <= datetime('now', 'localtime', '+24 hours'))
        ORDER BY CASE WHEN s.estado = 'pausada' THEN 0 ELSE 1 END, s.data_hora DESC
    `;
    db.all(query, [techId], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/servicos/:id/detalhes-relatorio', authenticateJWT, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const { id } = req.params;
    const query = `
        SELECT s.*, 
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora) as data_hora,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora_inicio) as data_hora_inicio,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora_fim) as data_hora_fim,
               c.nome as cliente_nome, c.telefone as cliente_contato, c.email as cliente_email, c.NIF as cliente_nif,
               (SELECT group_concat(tecnico_id) FROM servico_tecnicos WHERE servico_id = s.id) as tecnico_id,
               COALESCE((SELECT group_concat(t2.nome, ', ') FROM servico_tecnicos st2 JOIN tecnicos t2 ON st2.tecnico_id = t2.id WHERE st2.servico_id = s.id), 'Não Atribuído') as tecnico_nome
        FROM servicos s
        LEFT JOIN clientes c ON s.cliente_id = c.id
        WHERE s.id = ?
    `;
    db.get(query, [id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Serviço não encontrado" });

        db.all(`SELECT id, caminho FROM fotos_relatorio WHERE servico_id = ?`, [id], (err, fotos) => {
            if (err) return handleDBError(res, err);
            row.fotos = fotos || [];
            
            const machinesQuery = `
                SELECT m.id, m.marca, m.modelo, m.numero_serie
                FROM servico_maquinas sm
                JOIN maquinas m ON sm.maquina_id = m.id
                WHERE sm.servico_id = ?
            `;
            db.all(machinesQuery, [id], (err, machines) => {
                if (err) return handleDBError(res, err);
                row.maquinas = machines || [];
                res.json(row);
            });
        });
    });
});

app.put('/api/tecnico/servicos/:id/relatorio', authenticateJWT, isTecnico, (req, res) => {
    const { id } = req.params;
    const { relatorio, pecas_substituidas, horas_trabalho, assinatura_cliente, assinatura_tecnico, deslocacoes } = req.body;
    const techId = req.user.id;

    db.get(`SELECT relatorio_submetido, EXISTS (SELECT 1 FROM servico_tecnicos WHERE servico_id = s.id AND tecnico_id = ?) as is_assigned
            FROM servicos s WHERE s.id = ?`, [techId, id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Serviço não encontrado" });
        if (!row.is_assigned) return res.status(403).json({ error: "Acesso negado" });
        if (row.relatorio_submetido === 1) return res.status(400).json({ error: "Relatório já submetido" });

        const horasNum = (horas_trabalho !== null && horas_trabalho !== '') ? parseFloat(String(horas_trabalho).replace(',', '.')) : null;
        const deslocacoesNum = (deslocacoes !== null && deslocacoes !== undefined && deslocacoes !== '') ? parseInt(deslocacoes) : 1;

        db.run(`UPDATE servicos SET relatorio = ?, pecas_substituidas = ?, horas_trabalho = ?, assinatura_cliente = ?, assinatura_tecnico = ?, deslocacoes = ? WHERE id = ?`,
            [relatorio, pecas_substituidas, horasNum, assinatura_cliente, assinatura_tecnico, deslocacoesNum, id], (err) => {
                if (err) return handleDBError(res, err);
                res.json({ message: "Rascunho de serviço salvo" });
            });
    });
});

app.post('/api/tecnico/servicos/:id/submeter-relatorio', authenticateJWT, isTecnico, (req, res) => {
    const { id } = req.params;
    const techId = req.user.id;

    db.get(`SELECT relatorio_submetido, pecas_substituidas, cliente_id, EXISTS (SELECT 1 FROM servico_tecnicos WHERE servico_id = s.id AND tecnico_id = ?) as is_assigned
            FROM servicos s WHERE s.id = ?`, [techId, id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Serviço não encontrado" });
        if (!row.is_assigned) return res.status(403).json({ error: "Acesso negado" });
        if (row.relatorio_submetido === 1) return res.status(400).json({ error: "Relatório já submetido" });

        const metadata = {
            userId: techId,
            userRole: 'tecnico',
            refId: id,
            tipoMovimento: 'consumo_servico',
            clienteId: row.cliente_id
        };

        deductStockFromReportParts(row.pecas_substituidas, metadata, (deductErr) => {
            if (deductErr) return handleStockOrDBError(res, deductErr);

            db.run(`UPDATE servicos SET relatorio_submetido = 1 WHERE id = ?`, [id], function (err) {
                if (err) return handleDBError(res, err);
                securityLog('RELATORIO_SERVICO_SUBMETIDO', { service_id: id, tecnico_id: techId });
                res.json({ message: "Relatório submetido" });
            });
        });
    });
});

// --- MANUTENÇÕES ROUTES ---

app.get('/api/manutencoes', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT m.*, c.nome as cliente_nome, 
               (SELECT group_concat(tecnico_id) FROM manutencao_tecnicos WHERE manutencao_id = m.id) as tecnico_id,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.data_hora) as data_hora,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.data_hora_pausa) as data_hora_pausa,
               COALESCE((SELECT group_concat(t2.nome, ', ') FROM manutencao_tecnicos mt2 JOIN tecnicos t2 ON mt2.tecnico_id = t2.id WHERE mt2.manutencao_id = m.id), 'Não Atribuído') as tecnico_nome
        FROM manutencoes m
        LEFT JOIN clientes c ON m.cliente_id = c.id
        WHERE m.arquivada = 0
          AND NOT (
              m.estado = 'pendente'
              AND (SELECT COUNT(*) FROM manutencao_tecnicos WHERE manutencao_id = m.id) = 0
              AND m.data_agendada IS NOT NULL
              AND m.data_agendada > strftime('%Y-%m-%d %H:%M:%S', 'now', '+7 days', 'localtime')
          )
        ORDER BY m.data_hora DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/manutencoes', authenticateJWT, isAdmin, (req, res) => {
    const { cliente_id, notas, data_agendada, maquina_ids } = req.body;
    let tecnico_ids = req.body.tecnico_ids;
    if (!tecnico_ids && req.body.tecnico_id) {
        tecnico_ids = [req.body.tecnico_id];
    }
    if (!Array.isArray(tecnico_ids)) {
        tecnico_ids = [];
    }

    if (!cliente_id) return res.status(400).json({ error: "Cliente é obrigatório" });

    const main_tecnico_id = tecnico_ids.length > 0 ? tecnico_ids[0] : null;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        db.run(`INSERT INTO manutencoes (cliente_id, tecnico_id, notas, data_agendada) VALUES (?, ?, ?, ?)`,
            [cliente_id, main_tecnico_id, notas, data_agendada || null],
            function (err) {
                if (err) {
                    db.run('ROLLBACK');
                    return handleDBError(res, err);
                }
                const manutencaoId = this.lastID;

                const insertTechs = () => {
                    const stmt = db.prepare(`INSERT INTO manutencao_tecnicos (manutencao_id, tecnico_id) VALUES (?, ?)`);
                    tecnico_ids.forEach(tid => {
                        stmt.run(manutencaoId, tid);
                    });
                    stmt.finalize((err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return handleDBError(res, err);
                        }

                        db.run('COMMIT', (commitErr) => {
                            if (commitErr) return handleDBError(res, commitErr);
                            sendNotificationAndRespond(manutencaoId);
                        });
                    });
                };

                if (Array.isArray(maquina_ids) && maquina_ids.length > 0) {
                    const stmt = db.prepare(`INSERT INTO manutencao_maquinas (manutencao_id, maquina_id) VALUES (?, ?)`);
                    let hasError = false;

                    maquina_ids.forEach(mId => {
                        stmt.run(manutencaoId, mId, (err) => {
                            if (err) {
                                console.error('[DB ERROR] Error inserting maintenance machine:', err);
                                hasError = true;
                            }
                        });
                    });

                    stmt.finalize((err) => {
                        if (err || hasError) {
                            db.run('ROLLBACK');
                            return handleDBError(res, err || new Error("Erro ao associar máquinas"));
                        }
                        insertTechs();
                    });
                } else {
                    insertTechs();
                }
            }
        );
    });

    function sendNotificationAndRespond(manutencaoId) {
        if (tecnico_ids.length > 0) {
            db.all(`SELECT nome, email FROM tecnicos WHERE id IN (${tecnico_ids.map(() => '?').join(',')})`, tecnico_ids, (err, techs) => {
                if (!err && techs) {
                    db.get(`SELECT nome FROM clientes WHERE id = ?`, [cliente_id], (err, client) => {
                        if (client) {
                            techs.forEach(tech => {
                                if (tech.email) {
                                    sendAssignmentEmail(tech.email, tech.nome, 'Manutenção Geral', client.nome, notas, 'manutencao');
                                }
                            });
                        }
                    });
                }
            });
        }
        res.status(201).json({ id: manutencaoId, message: "Manutenção criada com sucesso" });
    }
});

app.put('/api/manutencoes/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { cliente_id, notas, data_agendada, maquina_ids } = req.body;
    let tecnico_ids = req.body.tecnico_ids;
    if (!tecnico_ids && req.body.tecnico_id) {
        tecnico_ids = [req.body.tecnico_id];
    }
    if (!Array.isArray(tecnico_ids)) {
        tecnico_ids = [];
    }

    if (!cliente_id) return res.status(400).json({ error: "Cliente é obrigatório" });

    db.get('SELECT estado FROM manutencoes WHERE id = ?', [id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Manutenção não encontrada" });
        if (row.estado !== 'pendente') {
            return res.status(400).json({ error: "Apenas manutenções pendentes podem ser editadas." });
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            const main_tecnico_id = tecnico_ids.length > 0 ? tecnico_ids[0] : null;

            db.run(`UPDATE manutencoes SET cliente_id = ?, tecnico_id = ?, notas = ?, data_agendada = ? WHERE id = ?`,
                [cliente_id, main_tecnico_id, notas, data_agendada || null, id],
                function (err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return handleDBError(res, err);
                    }

                    db.run('DELETE FROM manutencao_tecnicos WHERE manutencao_id = ?', [id], (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return handleDBError(res, err);
                        }

                        const insertTechs = () => {
                            const stmt = db.prepare(`INSERT INTO manutencao_tecnicos (manutencao_id, tecnico_id) VALUES (?, ?)`);
                            tecnico_ids.forEach(tid => {
                                stmt.run(id, tid);
                            });
                            stmt.finalize((err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return handleDBError(res, err);
                                }

                                db.run('COMMIT', (err) => {
                                    if (err) return handleDBError(res, err);
                                    res.json({ message: "Manutenção atualizada com sucesso" });
                                });
                            });
                        };

                        db.run('DELETE FROM manutencao_maquinas WHERE manutencao_id = ?', [id], (err) => {
                            if (err) {
                                db.run('ROLLBACK');
                                return handleDBError(res, err);
                            }

                            if (Array.isArray(maquina_ids) && maquina_ids.length > 0) {
                                const stmt = db.prepare(`INSERT INTO manutencao_maquinas (manutencao_id, maquina_id) VALUES (?, ?)`);
                                let hasError = false;

                                maquina_ids.forEach(mId => {
                                    stmt.run(id, mId, (err) => {
                                        if (err) {
                                            console.error('[DB ERROR] Error inserting maintenance machine:', err);
                                            hasError = true;
                                        }
                                    });
                                });

                                stmt.finalize((err) => {
                                    if (err || hasError) {
                                        db.run('ROLLBACK');
                                        return handleDBError(res, err || new Error("Erro ao associar máquinas"));
                                    }
                                    insertTechs();
                                });
                            } else {
                                insertTechs();
                            }
                        });
                    });
                }
            );
        });
    });
});

app.put('/api/manutencoes/:id/atribuir', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    let tecnico_ids = req.body.tecnico_ids;
    if (!tecnico_ids && req.body.tecnico_id) {
        tecnico_ids = [req.body.tecnico_id];
    }
    if (!Array.isArray(tecnico_ids) || tecnico_ids.length === 0) {
        return res.status(400).json({ error: "IDs dos técnicos são obrigatórios" });
    }

    db.all(`SELECT id, nome, email FROM tecnicos WHERE id IN (${tecnico_ids.map(() => '?').join(',')})`, tecnico_ids, (err, techs) => {
        if (err) return handleDBError(res, err);
        if (!techs || techs.length === 0) return res.status(404).json({ error: "Nenhum técnico encontrado" });

        const main_tecnico_id = tecnico_ids[0];

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            db.run(`UPDATE manutencoes SET tecnico_id = ? WHERE id = ?`, [main_tecnico_id, id], function (err) {
                if (err) {
                    db.run('ROLLBACK');
                    return handleDBError(res, err);
                }

                db.run(`DELETE FROM manutencao_tecnicos WHERE manutencao_id = ?`, [id], function (err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return handleDBError(res, err);
                    }

                    const stmt = db.prepare(`INSERT INTO manutencao_tecnicos (manutencao_id, tecnico_id) VALUES (?, ?)`);
                    tecnico_ids.forEach(tid => {
                        stmt.run(id, tid);
                    });
                    stmt.finalize((err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return handleDBError(res, err);
                        }

                        db.run('COMMIT', (err) => {
                            if (err) return handleDBError(res, err);

                            db.get(`SELECT m.notas, c.nome as client_nome 
                                   FROM manutencoes m JOIN clientes c ON c.id = m.cliente_id 
                                   WHERE m.id = ?`, [id], (err, row) => {
                                if (!err && row) {
                                    techs.forEach(tech => {
                                        if (tech.email) {
                                            sendAssignmentEmail(tech.email, tech.nome, 'Manutenção Geral', row.client_nome, row.notas, 'manutencao');
                                        }
                                    });
                                }
                            });

                            res.json({ message: "Técnicos atribuídos à manutenção", tecnico_ids });
                        });
                    });
                });
            });
        });
    });
});

app.put('/api/manutencoes/:id/status', authenticateJWT, isAdminOrTecnico, (req, res) => {
    const { id } = req.params;
    const { estado, relatorio } = req.body;

    if (!['pendente', 'em resolução', 'resolvida', 'pausada'].includes(estado)) {
        return res.status(400).json({ error: "Estado inválido" });
    }

    let query;
    let params = [estado];

    if (estado === 'em resolução') {
        query = `UPDATE manutencoes SET estado = ?, data_hora_inicio = CURRENT_TIMESTAMP WHERE id = ?`;
        params.push(id);
    } else if (estado === 'resolvida') {
        query = `UPDATE manutencoes SET estado = ?, data_hora_fim = CURRENT_TIMESTAMP,
                 tempo_acumulado = COALESCE(tempo_acumulado, 0) + (CASE WHEN estado = 'em resolução' THEN CAST((strftime('%s', 'now') - strftime('%s', COALESCE(data_hora_inicio, 'now'))) AS INTEGER) ELSE 0 END),
                 horas_trabalho = (COALESCE(tempo_acumulado, 0) + (CASE WHEN estado = 'em resolução' THEN CAST((strftime('%s', 'now') - strftime('%s', COALESCE(data_hora_inicio, 'now'))) AS INTEGER) ELSE 0 END)) / 3600.0
                 ${relatorio ? ', relatorio = ?' : ''} WHERE id = ?`;
        if (relatorio) params.push(relatorio);
        params.push(id);
    } else if (estado === 'pausada') {
        query = `UPDATE manutencoes SET estado = ?, data_hora_pausa = CURRENT_TIMESTAMP,
                 tempo_acumulado = COALESCE(tempo_acumulado, 0) + CAST((strftime('%s', 'now') - strftime('%s', COALESCE(data_hora_inicio, 'now'))) AS INTEGER)
                 ${req.body.motivo_pausa ? ', relatorio = COALESCE(relatorio || \'\n\n\', \'\') || ?' : ''} WHERE id = ?`;
        if (req.body.motivo_pausa) {
            const stamp = `[Manutenção Pausada em ${new Date().toLocaleString('pt-PT')}]: ${req.body.motivo_pausa}`;
            params.push(stamp);
        }
        params.push(id);
    } else {
        query = `UPDATE manutencoes SET estado = ? WHERE id = ?`;
        params.push(id);
    }

    db.run(query, params, function (err) {
        if (err) return handleDBError(res, err);
        res.json({ message: "Estado da manutenção atualizado", id, estado });
    });
});

app.put('/api/manutencoes/:id/arquivar', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE manutencoes SET arquivada = 1 WHERE id = ?`, [id], (err) => {
        if (err) return handleDBError(res, err);
        res.json({ message: "Manutenção arquivada" });
    });
});

app.put('/api/manutencoes/:id/agendamento', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { data_agendada, notas } = req.body;
    let tecnico_ids = req.body.tecnico_ids;
    if (!tecnico_ids && req.body.tecnico_id) {
        tecnico_ids = [req.body.tecnico_id];
    }
    if (!Array.isArray(tecnico_ids)) {
        tecnico_ids = [];
    }

    const main_tecnico_id = tecnico_ids.length > 0 ? tecnico_ids[0] : null;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run(`UPDATE manutencoes SET data_agendada = ?, notas = ?, tecnico_id = ? WHERE id = ?`,
            [data_agendada || null, notas, main_tecnico_id, id], function (err) {
                if (err) {
                    db.run('ROLLBACK');
                    return handleDBError(res, err);
                }

                db.run(`DELETE FROM manutencao_tecnicos WHERE manutencao_id = ?`, [id], function (err) {
                    if (err) {
                        db.run('ROLLBACK');
                        return handleDBError(res, err);
                    }

                    if (tecnico_ids.length === 0) {
                        db.run('COMMIT', (err) => {
                            if (err) return handleDBError(res, err);
                            res.json({ message: "Agendamento da manutenção atualizado" });
                        });
                        return;
                    }

                    const stmt = db.prepare(`INSERT INTO manutencao_tecnicos (manutencao_id, tecnico_id) VALUES (?, ?)`);
                    tecnico_ids.forEach(tid => {
                        stmt.run(id, tid);
                    });
                    stmt.finalize((err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return handleDBError(res, err);
                        }

                        db.run('COMMIT', (err) => {
                            if (err) return handleDBError(res, err);
                            res.json({ message: "Agendamento da manutenção atualizado" });
                        });
                    });
                });
            });
    });
});

// 🔒 CORREÇÃO: Validação do estado de faturação de manutenções
app.put('/api/manutencoes/:id/faturacao', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { estado_faturacao, numero_fatura } = req.body;

    const allowed = ['Por Faturar', 'Para Faturar', 'Faturado', 'Oferta', 'Garantia'];
    if (!allowed.includes(estado_faturacao)) {
        return res.status(400).json({ error: "Estado de faturação inválido" });
    }

    db.run(`UPDATE manutencoes SET estado_faturacao = ?, numero_fatura = ? WHERE id = ?`, [estado_faturacao, numero_fatura || null, id], function (err) {
        if (err) return handleDBError(res, err);
        securityLog('MANUTENCAO_FATURACAO_CHANGED', { manutencao_id: id, novo_estado: estado_faturacao, numero_fatura });
        res.json({ message: "Estado de faturação atualizado com sucesso", id, estado_faturacao, numero_fatura });
    });
});

// Apagar manutenção (Permanente)
app.delete('/api/manutencoes/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.serialize(() => {
        db.run(`DELETE FROM fotos_relatorio WHERE manutencao_id = ?`, [id]);
        db.run(`DELETE FROM manutencao_maquinas WHERE manutencao_id = ?`, [id]);
        db.run(`DELETE FROM manutencoes WHERE id = ?`, [id], function (err) {
            if (err) return handleDBError(res, err);
            securityLog('MANUTENCAO_DELETED', { manutencao_id: id, admin_id: req.user.id });
            res.json({ message: "Manutenção removida com sucesso" });
        });
    });
});


app.get('/api/tecnico/manutencoes', authenticateJWT, isTecnico, (req, res) => {
    const techId = req.user.id;
    const query = `
        SELECT m.*, c.nome as cliente_nome, c.morada as cliente_morada,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.data_hora) as data_hora,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.data_hora_inicio) as data_hora_inicio,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.data_hora_pausa) as data_hora_pausa
        FROM manutencoes m
        JOIN clientes c ON m.cliente_id = c.id
        WHERE EXISTS (SELECT 1 FROM manutencao_tecnicos WHERE manutencao_id = m.id AND tecnico_id = ?) AND m.estado != 'resolvida' AND m.arquivada = 0
        ORDER BY CASE WHEN m.estado = 'pausada' THEN 0 ELSE 1 END, m.data_hora DESC
    `;
    db.all(query, [techId], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/tecnico/manutencoes/historico', authenticateJWT, isTecnico, (req, res) => {
    const techId = req.user.id;
    const query = `
        SELECT m.*, c.nome as cliente_nome,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.data_hora) as data_hora,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.data_hora_fim) as data_hora_fim
        FROM manutencoes m
        JOIN clientes c ON m.cliente_id = c.id
        WHERE EXISTS (SELECT 1 FROM manutencao_tecnicos WHERE manutencao_id = m.id AND tecnico_id = ?) AND m.estado = 'resolvida'
        ORDER BY m.data_hora_fim DESC
        LIMIT 50
    `;
    db.all(query, [techId], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/manutencoes/:id/detalhes-relatorio', authenticateJWT, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const { id } = req.params;
    const query = `
        SELECT m.*, 
               strftime('%Y-%m-%dT%H:%M:%SZ', m.data_hora) as data_hora,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.data_hora_inicio) as data_hora_inicio,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.data_hora_fim) as data_hora_fim,
               c.nome as cliente_nome, c.telefone as cliente_contato, c.email as cliente_email, c.NIF as cliente_nif,
               (SELECT group_concat(tecnico_id) FROM manutencao_tecnicos WHERE manutencao_id = m.id) as tecnico_id,
               COALESCE((SELECT group_concat(t2.nome, ', ') FROM manutencao_tecnicos mt2 JOIN tecnicos t2 ON mt2.tecnico_id = t2.id WHERE mt2.manutencao_id = m.id), 'Não Atribuído') as tecnico_nome
        FROM manutencoes m
        LEFT JOIN clientes c ON m.cliente_id = c.id
        WHERE m.id = ?
    `;
    db.get(query, [id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Manutenção não encontrada" });

        db.all(`SELECT id, caminho FROM fotos_relatorio WHERE manutencao_id = ?`, [id], (err, fotos) => {
            if (err) return handleDBError(res, err);
            row.fotos = fotos || [];

            // Adicionar máquinas associadas
            const machinesQuery = `
                SELECT m.id, m.marca, m.modelo, m.numero_serie
                FROM manutencao_maquinas mm
                JOIN maquinas m ON mm.maquina_id = m.id
                WHERE mm.manutencao_id = ?
            `;
            db.all(machinesQuery, [id], (err, machines) => {
                if (err) return handleDBError(res, err);
                row.maquinas = machines || [];
                res.json(row);
            });
        });
    });
});

// 🔒 CORREÇÃO: relatorio de manutenção — validar submissão + parse horas
app.put('/api/tecnico/manutencoes/:id/relatorio', authenticateJWT, isTecnico, (req, res) => {
    const { id } = req.params;
    const { relatorio, pecas_substituidas, horas_trabalho, assinatura_cliente, assinatura_tecnico, deslocacoes } = req.body;
    const techId = req.user.id;

    db.get(`SELECT relatorio_submetido, EXISTS (SELECT 1 FROM manutencao_tecnicos WHERE manutencao_id = m.id AND tecnico_id = ?) as is_assigned
            FROM manutencoes m WHERE m.id = ?`, [techId, id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Manutenção não encontrada" });
        if (!row.is_assigned) return res.status(403).json({ error: "Acesso negado" });
        if (row.relatorio_submetido === 1) return res.status(400).json({ error: "Relatório já foi submetido e não pode ser editado." });

        const horasNum = (horas_trabalho !== null && horas_trabalho !== '') ? parseFloat(String(horas_trabalho).replace(',', '.')) : null;
        const deslocacoesNum = (deslocacoes !== null && deslocacoes !== undefined && deslocacoes !== '') ? parseInt(deslocacoes) : 1;

        db.run(`UPDATE manutencoes SET relatorio = ?, pecas_substituidas = ?, horas_trabalho = ?, assinatura_cliente = ?, assinatura_tecnico = ?, deslocacoes = ? WHERE id = ?`,
            [relatorio, pecas_substituidas, horasNum, assinatura_cliente, assinatura_tecnico, deslocacoesNum, id], function (err) {
                if (err) return handleDBError(res, err);
                res.json({ message: "Rascunho de manutenção salvo" });
            });
    });
});

app.post('/api/tecnico/manutencoes/:id/submeter-relatorio', authenticateJWT, isTecnico, (req, res) => {
    const { id } = req.params;
    const techId = req.user.id;

    db.get(`SELECT relatorio_submetido, pecas_substituidas, cliente_id, EXISTS (SELECT 1 FROM manutencao_tecnicos WHERE manutencao_id = m.id AND tecnico_id = ?) as is_assigned
            FROM manutencoes m WHERE m.id = ?`, [techId, id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Manutenção não encontrada" });
        if (!row.is_assigned) return res.status(403).json({ error: "Acesso negado" });
        if (row.relatorio_submetido === 1) return res.status(400).json({ error: "Relatório já submetido" });

        const metadata = {
            userId: techId,
            userRole: 'tecnico',
            refId: id,
            tipoMovimento: 'consumo_manutencao',
            clienteId: row.cliente_id
        };

        deductStockFromReportParts(row.pecas_substituidas, metadata, (deductErr) => {
            if (deductErr) return handleStockOrDBError(res, deductErr);

            db.run(`UPDATE manutencoes SET relatorio_submetido = 1 WHERE id = ?`, [id], function (err) {
                if (err) return handleDBError(res, err);
                securityLog('RELATORIO_MANUTENCAO_SUBMETIDO', { manutencao_id: id, tecnico_id: techId });
                res.json({ message: "Relatório de manutenção submetido" });
            });
        });
    });
});

// --- LASER CUTTING ROUTES ---

// Manage Colaboradores (Admin)
app.get('/api/colaboradores', authenticateJWT, isAdmin, (req, res) => {
    db.all(`SELECT id, nome, email FROM colaboradores`, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/colaboradores', authenticateJWT, isAdmin, (req, res) => {
    const { nome, email, password } = req.body;
    if (!nome || !email || !password) return res.status(400).json({ error: "Todos os campos são obrigatórios" });
    const hash = bcrypt.hashSync(password, 10);
    db.run(`INSERT INTO colaboradores (nome, email, password) VALUES (?, ?, ?)`, [nome, email, hash], function (err) {
        if (err) return handleDBError(res, err);
        res.status(201).json({ id: this.lastID, nome, email });
    });
});

app.put('/api/colaboradores/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { nome, email, password } = req.body;

    if (password) {
        const hash = bcrypt.hashSync(password, 10);
        db.run(`UPDATE colaboradores SET nome = ?, email = ?, password = ? WHERE id = ?`, [nome, email, hash, id], function (err) {
            if (err) return handleDBError(res, err);
            res.json({ message: "Colaborador atualizado" });
        });
    } else {
        db.run(`UPDATE colaboradores SET nome = ?, email = ? WHERE id = ?`, [nome, email, id], function (err) {
            if (err) return handleDBError(res, err);
            res.json({ message: "Colaborador atualizado" });
        });
    }
});

app.delete('/api/colaboradores/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM colaboradores WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        res.json({ message: "Colaborador removido" });
    });
});


// Manage Tecnico Laser (Admin)
app.get('/api/tecnico-laser', authenticateJWT, isAdmin, (req, res) => {
    db.all(`SELECT id, nome, email FROM tecnico_laser`, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/tecnico-laser', authenticateJWT, isAdmin, (req, res) => {
    const { nome, email, password } = req.body;
    if (!nome || !email || !password) return res.status(400).json({ error: "Todos os campos são obrigatórios" });
    const hash = bcrypt.hashSync(password, 10);
    db.run(`INSERT INTO tecnico_laser (nome, email, password) VALUES (?, ?, ?)`, [nome, email, hash], function (err) {
        if (err) return handleDBError(res, err);
        res.status(201).json({ id: this.lastID, nome, email });
    });
});

app.put('/api/tecnico-laser/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { nome, email, password } = req.body;

    if (password) {
        const hash = bcrypt.hashSync(password, 10);
        db.run(`UPDATE tecnico_laser SET nome = ?, email = ?, password = ? WHERE id = ?`, [nome, email, hash, id], function (err) {
            if (err) return handleDBError(res, err);
            res.json({ message: "Técnico laser atualizado" });
        });
    } else {
        db.run(`UPDATE tecnico_laser SET nome = ?, email = ? WHERE id = ?`, [nome, email, id], function (err) {
            if (err) return handleDBError(res, err);
            res.json({ message: "Técnico laser atualizado" });
        });
    }
});

app.delete('/api/tecnico-laser/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM tecnico_laser WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        res.json({ message: "Técnico laser removido" });
    });
});


// Laser Tasks
app.get('/api/laser/tasks', authenticateJWT, (req, res) => {
    let query = `SELECT * FROM laser_tasks ORDER BY data_criacao DESC`;
    let params = [];

    if (req.user.role === 'tecnico_laser') {
        query = `SELECT * FROM laser_tasks WHERE estado IN ('em corte', 'concluido', 'pausado', 'pronto para corte') ORDER BY data_criacao DESC`;
    }

    db.all(query, params, (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/laser/tasks', authenticateJWT, isAdmin, (req, res) => {
    const { cliente_nome, descricao } = req.body;
    if (!cliente_nome) return res.status(400).json({ error: "Nome do cliente é obrigatório" });

    db.run(`INSERT INTO laser_tasks (cliente_nome, descricao, estado) VALUES (?, ?, 'pendente')`,
        [cliente_nome, descricao], function (err) {
            if (err) return handleDBError(res, err);
            res.status(201).json({ id: this.lastID, message: "Tarefa laser criada" });
        });
});

// Update status and handle file upload for drawing
const laserStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = 'uploads/laser';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'laser-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const uploadLaser = multer({ storage: laserStorage });

app.put('/api/laser/tasks/:id/upload', authenticateJWT, isColaborador, uploadLaser.single('desenho'), (req, res) => {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: "Ficheiro de desenho é obrigatório" });

    const caminho = `/uploads/laser/${req.file.filename}`;
    const nomeOriginal = req.file.originalname;

    db.run(`UPDATE laser_tasks SET desenho_caminho = ?, desenho_nome_original = ?, estado = 'pronto para corte', colaborador_id = ? WHERE id = ?`,
        [caminho, nomeOriginal, req.user.id, id], function (err) {
            if (err) return handleDBError(res, err);
            res.json({ message: "Desenho submetido e pronto para corte", caminho });
        });
});

app.put('/api/laser/tasks/:id/status', authenticateJWT, (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;
    const role = req.user.role;

    if (role === 'tecnico_laser') {
        db.get(`SELECT estado, data_hora_inicio, tempo_total_segundos, tempo_total_minutos FROM laser_tasks WHERE id = ?`, [id], (err, task) => {
            if (err || !task) return res.status(404).json({ error: "Tarefa não encontrada" });

            let query = `UPDATE laser_tasks SET estado = ?, tecnico_laser_id = ?`;
            let params = [estado, req.user.id];
            let additionalSeconds = 0;
            const nowIso = new Date().toISOString();

            if (estado === 'em corte') {
                query += `, data_hora_inicio = ?`;
                params.splice(2, 0, nowIso); // Insert before id
            } else if (estado === 'pausado' || estado === 'concluido') {
                if (task.estado === 'em corte' && task.data_hora_inicio) {
                    const start = new Date(task.data_hora_inicio);
                    const now = new Date();
                    additionalSeconds = Math.floor((now - start) / 1000);
                }

                if (estado === 'pausado') {
                    query += `, data_hora_pausa = ?`;
                } else {
                    query += `, data_hora_fim = ?`;
                }
                params.splice(2, 0, nowIso);

                const totalSeconds = (task.tempo_total_segundos || 0) + additionalSeconds;
                const totalMinutes = Math.ceil(totalSeconds / 60);

                query += `, tempo_total_segundos = ?, tempo_total_minutos = ?`;
                params.splice(3, 0, totalSeconds, totalMinutes);
            }

            query += ` WHERE id = ?`;
            params.push(id);

            db.run(query, params, function (err) {
                if (err) return handleDBError(res, err);
                const totalSeconds = (task.tempo_total_segundos || 0) + additionalSeconds;
                res.json({
                    message: "Estado atualizado",
                    estado,
                    total_seconds: totalSeconds,
                    total_minutos: Math.ceil(totalSeconds / 60)
                });
            });
        });
    } else if (role === 'admin') {
        db.run(`UPDATE laser_tasks SET estado = ? WHERE id = ?`, [estado, id], function (err) {
            if (err) return handleDBError(res, err);
            res.json({ message: "Estado atualizado pelo admin", estado });
        });
    } else {
        res.status(403).json({ error: "Não autorizado" });
    }
});

app.delete('/api/laser/tasks/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM laser_tasks WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        res.json({ message: "Tarefa removida" });
    });
});

app.get('/uploads/laser/:filename', (req, res) => {
    const token = req.query.token || req.headers.authorization?.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, SECRET_KEY, (err) => {
        if (err) return res.sendStatus(401);

        const filePath = path.join(__dirname, 'uploads', 'laser', req.params.filename);
        if (fs.existsSync(filePath)) {
            res.download(filePath);
        } else {
            res.sendStatus(404);
        }
    });
});

// --- Upload e Gestão de Fotos ---
app.post('/api/tecnico/upload-fotos', authenticateJWT, isTecnico, (req, res, next) => {
    upload.array('fotos', 10)(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: "Uma das fotos é demasiado grande. O limite é de 20MB." });
            }
            if (err.code === 'LIMIT_UNEXPECTED_FILE') {
                return res.status(400).json({ error: "Limite de 10 fotos excedido." });
            }
            return res.status(400).json({ error: `Erro no upload: ${err.message}` });
        } else if (err) {
            return res.status(400).json({ error: err.message });
        }

        const { avaria_id, servico_id, manutencao_id } = req.body;
        if (!avaria_id && !servico_id && !manutencao_id) {
            return res.status(400).json({ error: "ID da avaria, serviço ou manutenção é obrigatório" });
        }

        const techId = req.user.id;
        const targetId = avaria_id || servico_id || manutencao_id;
        const column = avaria_id ? 'avaria_id' : (servico_id ? 'servico_id' : 'manutencao_id');
        const table = avaria_id ? 'avarias' : (servico_id ? 'servicos' : 'manutencoes');

        let checkQuery;
        if (avaria_id) checkQuery = `SELECT EXISTS (SELECT 1 FROM avaria_tecnicos WHERE avaria_id = ? AND tecnico_id = ?) as is_assigned`;
        else if (servico_id) checkQuery = `SELECT EXISTS (SELECT 1 FROM servico_tecnicos WHERE servico_id = ? AND tecnico_id = ?) as is_assigned`;
        else checkQuery = `SELECT EXISTS (SELECT 1 FROM manutencao_tecnicos WHERE manutencao_id = ? AND tecnico_id = ?) as is_assigned`;

        db.get(checkQuery, [targetId, techId], (err, row) => {
            if (err) return handleDBError(res, err);
            if (!row || !row.is_assigned) {
                securityLog('UNAUTHORIZED_PHOTO_UPLOAD', { tecnico_id: techId, target_id: targetId, table });
                return res.status(403).json({ error: "Acesso negado: esta tarefa não lhe pertence." });
            }

            const stmt = db.prepare(`INSERT INTO fotos_relatorio (${column}, caminho) VALUES (?, ?)`);
            const paths = [];

            if (req.files) {
                req.files.forEach(file => {
                    const caminho = `/uploads/reports/${file.filename}`;
                    stmt.run(targetId, caminho);
                    paths.push(caminho);
                });
            }

            stmt.finalize((err) => {
                if (err) return handleDBError(res, err);
                const type = avaria_id ? 'avaria' : (servico_id ? 'servico' : 'manutencao');
                securityLog('PHOTOS_UPLOADED', { id: targetId, count: req.files ? req.files.length : 0, type });
                res.json({ message: "Fotos enviadas com sucesso", paths });
            });
        });
    });
});

app.delete('/api/tecnico/fotos/:id', authenticateJWT, isTecnico, (req, res) => {
    const { id } = req.params;
    const techId = req.user.id;

    const checkQuery = `
        SELECT f.caminho, f.avaria_id, f.servico_id, f.manutencao_id,
               EXISTS (SELECT 1 FROM avaria_tecnicos WHERE avaria_id = f.avaria_id AND tecnico_id = ?) as a_assigned,
               EXISTS (SELECT 1 FROM servico_tecnicos WHERE servico_id = f.servico_id AND tecnico_id = ?) as s_assigned,
               EXISTS (SELECT 1 FROM manutencao_tecnicos WHERE manutencao_id = f.manutencao_id AND tecnico_id = ?) as m_assigned
        FROM fotos_relatorio f
        WHERE f.id = ?
    `;

    db.get(checkQuery, [techId, techId, techId, id], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Foto não encontrada" });

        const isAssigned = (row.avaria_id && row.a_assigned) || 
                           (row.servico_id && row.s_assigned) || 
                           (row.manutencao_id && row.m_assigned);
        if (!isAssigned) return res.status(403).json({ error: "Acesso negado" });

        db.run(`DELETE FROM fotos_relatorio WHERE id = ?`, [id], function (err) {
            if (err) return handleDBError(res, err);

            const relativePath = row.caminho.startsWith('/') ? row.caminho.substring(1) : row.caminho;
            const fullPath = path.join(__dirname, relativePath);
            fs.unlink(fullPath, (err) => {
                if (err) console.error("Erro ao apagar ficheiro:", err);
            });

            securityLog('PHOTO_DELETED', { photo_id: id, path: row.caminho });
            res.json({ message: "Foto removida" });
        });
    });
});

app.get('/api/historico/servicos', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT s.*, c.nome as cliente_nome,
               (SELECT group_concat(tecnico_id) FROM servico_tecnicos WHERE servico_id = s.id) as tecnico_id,
               COALESCE((SELECT group_concat(t.nome, ', ') FROM servico_tecnicos st JOIN tecnicos t ON st.tecnico_id = t.id WHERE st.servico_id = s.id), 'Não Atribuído') as tecnico_nome,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora) as data_hora,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora_fim) as data_hora_fim
        FROM servicos s
        LEFT JOIN clientes c ON s.cliente_id = c.id
        WHERE s.estado = 'resolvida'
        ORDER BY s.data_hora_fim DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/agendamentos', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT 'avaria' as type, a.id, a.maquina_id, a.tipo_avaria, a.estado, a.notas, 
               (SELECT group_concat(tecnico_id) FROM avaria_tecnicos WHERE avaria_id = a.id) as tecnico_id,
               a.data_agendada,
               COALESCE(m.marca || ' - ' || m.modelo, 'Máquina Removida') as title,
               c.nome as cliente_nome, 
               COALESCE((SELECT group_concat(t.nome, ', ') FROM avaria_tecnicos at JOIN tecnicos t ON at.tecnico_id = t.id WHERE at.avaria_id = a.id), 'Não Atribuído') as tecnico_nome
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        LEFT JOIN clientes c ON m.cliente_id = c.id
        WHERE a.data_agendada IS NOT NULL AND a.arquivada = 0
        
        UNION ALL
        
        SELECT 'servico' as type, s.id, NULL as maquina_id, s.tipo_servico as tipo_avaria, s.estado, s.notas, 
               (SELECT group_concat(tecnico_id) FROM servico_tecnicos WHERE servico_id = s.id) as tecnico_id,
               s.data_agendada,
               s.tipo_servico || ' (' || s.tipo_camiao || ')' as title,
               c.nome as cliente_nome, 
               COALESCE((SELECT group_concat(t.nome, ', ') FROM servico_tecnicos st JOIN tecnicos t ON st.tecnico_id = t.id WHERE st.servico_id = s.id), 'Não Atribuído') as tecnico_nome
        FROM servicos s
        LEFT JOIN clientes c ON s.cliente_id = c.id
        WHERE s.data_agendada IS NOT NULL AND s.arquivada = 0

        UNION ALL

        SELECT 'manutencao' as type, mn.id, NULL as maquina_id, 'Manutenção Geral' as tipo_avaria, mn.estado, mn.notas, 
               (SELECT group_concat(tecnico_id) FROM manutencao_tecnicos WHERE manutencao_id = mn.id) as tecnico_id,
               mn.data_agendada,
               'Manutenção Geral' as title,
               c.nome as cliente_nome, 
               COALESCE((SELECT group_concat(t.nome, ', ') FROM manutencao_tecnicos mt JOIN tecnicos t ON mt.tecnico_id = t.id WHERE mt.manutencao_id = mn.id), 'Não Atribuído') as tecnico_nome
        FROM manutencoes mn
        LEFT JOIN clientes c ON mn.cliente_id = c.id
        WHERE mn.data_agendada IS NOT NULL AND mn.arquivada = 0
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/tecnico/agendamentos', authenticateJWT, isTecnico, (req, res) => {
    const techId = req.user.id;
    const query = `
        SELECT 'avaria' as type, a.id, a.maquina_id, a.tipo_avaria, a.estado,
               a.data_agendada,
               COALESCE(m.marca || ' - ' || m.modelo, 'Máquina Removida') as title,
               c.nome as cliente_nome, c.morada as cliente_morada, a.notas
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        LEFT JOIN clientes c ON m.cliente_id = c.id
        WHERE a.data_agendada IS NOT NULL AND EXISTS (SELECT 1 FROM avaria_tecnicos WHERE avaria_id = a.id AND tecnico_id = ?) AND a.estado != 'resolvida' AND a.arquivada = 0
        
        UNION ALL
        
        SELECT 'servico' as type, s.id, NULL as maquina_id, s.tipo_servico as tipo_avaria, s.estado,
               s.data_agendada,
               s.tipo_servico || ' (' || s.tipo_camiao || ')' as title,
               c.nome as cliente_nome, c.morada as cliente_morada, s.notas
        FROM servicos s
        LEFT JOIN clientes c ON s.cliente_id = c.id
        WHERE s.data_agendada IS NOT NULL AND EXISTS (SELECT 1 FROM servico_tecnicos WHERE servico_id = s.id AND tecnico_id = ?) AND s.estado != 'resolvida' AND s.arquivada = 0
        
        UNION ALL

        SELECT 'manutencao' as type, mn.id, NULL as maquina_id, 'Manutenção Geral' as tipo_avaria, mn.estado,
               mn.data_agendada,
               'Manutenção Geral' as title,
               c.nome as cliente_nome, c.morada as cliente_morada, mn.notas
        FROM manutencoes mn
        LEFT JOIN clientes c ON mn.cliente_id = c.id
        WHERE mn.data_agendada IS NOT NULL AND EXISTS (SELECT 1 FROM manutencao_tecnicos WHERE manutencao_id = mn.id AND tecnico_id = ?) AND mn.estado != 'resolvida' AND mn.arquivada = 0

        ORDER BY data_agendada ASC
    `;
    db.all(query, [techId, techId, techId], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});



app.get('/api/historico', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT 'avaria' as type, a.id, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora) as data_hora, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_fim) as data_hora_fim, 
               (SELECT group_concat(tecnico_id) FROM avaria_tecnicos WHERE avaria_id = a.id) as tecnico_id,
               COALESCE((SELECT group_concat(t2.nome, ', ') FROM avaria_tecnicos at2 JOIN tecnicos t2 ON at2.tecnico_id = t2.id WHERE at2.avaria_id = a.id), 'Não Atribuído') as tecnico_nome, 
               c.id as cliente_id, c.nome as cliente_nome, 
               (m.marca || ' - ' || m.modelo) as maquina_nome, m.uuid as maquina_uuid,
               a.horas_trabalho, a.estado_faturacao, a.numero_fatura, a.relatorio, a.relatorio_submetido
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        LEFT JOIN clientes c ON m.cliente_id = c.id
        WHERE a.estado = 'resolvida'

        UNION ALL

        SELECT 'servico' as type, s.id, 
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora) as data_hora, 
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora_fim) as data_hora_fim, 
               (SELECT group_concat(tecnico_id) FROM servico_tecnicos WHERE servico_id = s.id) as tecnico_id,
               COALESCE((SELECT group_concat(t2.nome, ', ') FROM servico_tecnicos st2 JOIN tecnicos t2 ON st2.tecnico_id = t2.id WHERE st2.servico_id = s.id), 'Não Atribuído') as tecnico_nome, 
               c.id as cliente_id, c.nome as cliente_nome, 
               s.tipo_servico || (CASE WHEN s.tipo_camiao IS NOT NULL AND s.tipo_camiao != '' THEN ' (' || s.tipo_camiao || ')' ELSE '' END) as maquina_nome, NULL as maquina_uuid,
               s.horas_trabalho, s.estado_faturacao, s.numero_fatura, s.relatorio, s.relatorio_submetido
        FROM servicos s
        LEFT JOIN clientes c ON s.cliente_id = c.id
        WHERE s.estado = 'resolvida'

        UNION ALL

        SELECT 'manutencao' as type, mn.id, 
               strftime('%Y-%m-%dT%H:%M:%SZ', mn.data_hora) as data_hora, 
               strftime('%Y-%m-%dT%H:%M:%SZ', mn.data_hora_fim) as data_hora_fim, 
               (SELECT group_concat(tecnico_id) FROM manutencao_tecnicos WHERE manutencao_id = mn.id) as tecnico_id,
               COALESCE((SELECT group_concat(t2.nome, ', ') FROM manutencao_tecnicos mt2 JOIN tecnicos t2 ON mt2.tecnico_id = t2.id WHERE mt2.manutencao_id = mn.id), 'Não Atribuído') as tecnico_nome, 
               c.id as cliente_id, c.nome as cliente_nome, 
               'Todas as Máquinas' as maquina_nome, NULL as maquina_uuid,
               mn.horas_trabalho, mn.estado_faturacao, mn.numero_fatura, mn.relatorio, mn.relatorio_submetido
        FROM manutencoes mn
        LEFT JOIN clientes c ON mn.cliente_id = c.id
        WHERE mn.estado = 'resolvida'
        
        ORDER BY data_hora_fim DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

// --- ADMINISTRADORES ROUTES ---

app.get('/api/administradores', authenticateJWT, isAdmin, (req, res) => {
    db.all(`SELECT id, username, email FROM administradores ORDER BY username ASC`, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/administradores', authenticateJWT, isAdmin, (req, res) => {
    let { username, email, password } = req.body;

    username = sanitizeString(username);
    email = sanitizeString(email, 255);

    if (!username || !email || !password) {
        return res.status(400).json({ error: "Username, Email e Password são obrigatórios" });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Formato de email inválido" });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: "A password deve ter pelo menos 6 caracteres" });
    }

    const hashedPwd = bcrypt.hashSync(password, 10);

    db.run(`INSERT INTO administradores (username, password, email) VALUES (?, ?, ?)`,
        [username, hashedPwd, email],
        function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(409).json({ error: "Username já está registado" });
                }
                return handleDBError(res, err);
            }
            securityLog('ADMINISTRADOR_CREATED', { id: this.lastID, username, email, created_by: req.user.id });
            res.status(201).json({
                id: this.lastID,
                username,
                email
            });
        });
});

app.delete('/api/administradores/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const currentAdminId = req.user.id;

    if (parseInt(id) === parseInt(currentAdminId)) {
        return res.status(400).json({ error: "Não pode eliminar o seu próprio utilizador administrador." });
    }

    db.get(`SELECT COUNT(*) as count FROM administradores`, [], (err, row) => {
        if (err) return handleDBError(res, err);
        if (row && row.count <= 1) {
            return res.status(400).json({ error: "Não é possível eliminar o último administrador do sistema." });
        }

        db.run(`DELETE FROM administradores WHERE id = ?`, [id], function (err) {
            if (err) return handleDBError(res, err);
            securityLog('ADMINISTRADOR_DELETED', { id, deleted_by: currentAdminId });
            res.json({ message: "Administrador removido com sucesso" });
        });
    });
});

app.put('/api/administradores/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    let { username, email, password } = req.body;

    username = sanitizeString(username);
    email = sanitizeString(email, 255);

    if (!username || !email) {
        return res.status(400).json({ error: "Username e Email são obrigatórios" });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Formato de email inválido" });
    }

    if (password) {
        if (password.length < 6) {
            return res.status(400).json({ error: "A password deve ter pelo menos 6 caracteres" });
        }
        const hashedPwd = bcrypt.hashSync(password, 10);
        db.run(`UPDATE administradores SET username = ?, email = ?, password = ? WHERE id = ?`,
            [username, email, hashedPwd, id],
            function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(409).json({ error: "Username já está registado" });
                    }
                    return handleDBError(res, err);
                }
                securityLog('ADMINISTRADOR_UPDATED', { id, username, email, password_changed: true, updated_by: req.user.id });
                res.json({ message: "Administrador atualizado com sucesso", id });
            });
    } else {
        db.run(`UPDATE administradores SET username = ?, email = ? WHERE id = ?`,
            [username, email, id],
            function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(409).json({ error: "Username já está registado" });
                    }
                    return handleDBError(res, err);
                }
                securityLog('ADMINISTRADOR_UPDATED', { id, username, email, password_changed: false, updated_by: req.user.id });
                res.json({ message: "Administrador atualizado com sucesso", id });
            });
    }
});

// --- TECNICOS ROUTES ---

app.get('/api/tecnicos', authenticateJWT, isAdmin, (req, res) => {
    db.all(`SELECT id, nome, especialidade, telefone, email FROM tecnicos`, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/tecnicos', authenticateJWT, isAdmin, (req, res) => {
    let { nome, especialidade, telefone, email } = req.body;

    nome = sanitizeString(nome);
    especialidade = sanitizeString(especialidade);
    telefone = sanitizeString(telefone, 15);
    email = sanitizeString(email, 255);

    if (!nome || !email) {
        return res.status(400).json({ error: "Nome e Email são obrigatórios" });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Formato de email inválido" });
    }

    if (telefone && !/^[0-9]{9}$/.test(telefone)) {
        return res.status(400).json({ error: "Telefone deve conter exatamente 9 dígitos numéricos" });
    }

    const generatedPassword = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedPwd = bcrypt.hashSync(generatedPassword, 10);

    db.run(`INSERT INTO tecnicos (nome, especialidade, telefone, email, password) VALUES (?, ?, ?, ?, ?)`,
        [nome, especialidade, telefone, email, hashedPwd],
        function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(409).json({ error: "Email já está registado" });
                }
                return handleDBError(res, err);
            }
            securityLog('TECNICO_CREATED', { id: this.lastID, nome, email });
            res.status(201).json({
                id: this.lastID,
                nome,
                especialidade,
                telefone,
                email,
                tempPassword: generatedPassword
            });
        });
});

app.put('/api/tecnicos/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    let { nome, especialidade, telefone, email, password } = req.body;

    nome = sanitizeString(nome);
    especialidade = sanitizeString(especialidade);
    telefone = sanitizeString(telefone, 15);
    email = sanitizeString(email, 255);

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Formato de email inválido" });
    if (telefone && !/^[0-9]{9}$/.test(telefone)) return res.status(400).json({ error: "Telefone deve conter exatamente 9 dígitos numéricos" });

    if (password) {
        const hashedPwd = bcrypt.hashSync(password, 10);
        db.run(`UPDATE tecnicos SET nome = ?, especialidade = ?, telefone = ?, email = ?, password = ? WHERE id = ?`,
            [nome, especialidade, telefone, email, hashedPwd, id],
            function (err) {
                if (err) return handleDBError(res, err);
                securityLog('TECNICO_UPDATED', { id, nome, email, password_changed: true });
                res.json({ message: "Técnico atualizado", id });
            });
    } else {
        db.run(`UPDATE tecnicos SET nome = ?, especialidade = ?, telefone = ?, email = ? WHERE id = ?`,
            [nome, especialidade, telefone, email, id],
            function (err) {
                if (err) return handleDBError(res, err);
                securityLog('TECNICO_UPDATED', { id, nome, email, password_changed: false });
                res.json({ message: "Técnico atualizado", id });
            });
    }
});

app.delete('/api/tecnicos/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM tecnicos WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        securityLog('TECNICO_DELETED', { id });
        res.json({ message: "Técnico removido" });
    });
});

// --- PORTAL DO TÉCNICO ---

app.get('/api/tecnico/avarias', authenticateJWT, isTecnico, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const techId = req.user.id;
    const query = `
        SELECT a.id, a.maquina_id, a.tipo_avaria, a.estado, a.data_agendada,
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora) as data_hora, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_inicio) as data_hora_inicio,
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_pausa) as data_hora_pausa, 
               a.tempo_acumulado,
               a.notas,
               a.relatorio, a.relatorio_submetido, a.pecas_substituidas, a.horas_trabalho,
               a.assinatura_cliente, a.assinatura_tecnico, a.deslocacoes,
               (m.marca || ' - ' || m.modelo) as maquina_nome, c.nome as cliente_nome, c.morada as cliente_morada
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        LEFT JOIN clientes c ON m.cliente_id = c.id
        WHERE EXISTS (SELECT 1 FROM avaria_tecnicos WHERE avaria_id = a.id AND tecnico_id = ?) 
          AND a.estado != 'resolvida' 
          AND a.arquivada = 0
          AND (a.data_agendada IS NULL OR datetime(a.data_agendada) <= datetime('now', 'localtime', '+24 hours'))
        ORDER BY CASE WHEN a.estado = 'pausada' THEN 0 ELSE 1 END, a.data_hora DESC
    `;
    db.all(query, [techId], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/tecnico/historico', authenticateJWT, isTecnico, (req, res) => {
    const techId = req.user.id;
    const query = `
        SELECT a.id, a.maquina_id, a.tipo_avaria, a.estado, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora) as data_hora, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_inicio) as data_hora_inicio, 
               strftime('%Y-%m-%dT%H:%M:%SZ', a.data_hora_fim) as data_hora_fim,
               a.notas, a.relatorio, a.relatorio_submetido, a.pecas_substituidas, a.horas_trabalho,
               a.assinatura_cliente, a.assinatura_tecnico, a.deslocacoes,
               (m.marca || ' - ' || m.modelo) as maquina_nome, m.uuid as maquina_uuid,
               c.nome as cliente_nome, c.id as cliente_id
         FROM avarias a
         LEFT JOIN maquinas m ON a.maquina_id = m.uuid
         LEFT JOIN clientes c ON m.cliente_id = c.id
         WHERE EXISTS (SELECT 1 FROM avaria_tecnicos WHERE avaria_id = a.id AND tecnico_id = ?) AND a.estado = 'resolvida'
         ORDER BY COALESCE(a.data_hora_fim, a.data_hora) DESC
         LIMIT 50
    `;
    db.all(query, [techId], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/tecnico/servicos/historico', authenticateJWT, isTecnico, (req, res) => {
    const techId = req.user.id;
    const query = `
        SELECT s.*, c.nome as cliente_nome,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora) as data_hora,
               strftime('%Y-%m-%dT%H:%M:%SZ', s.data_hora_fim) as data_hora_fim
        FROM servicos s
        JOIN clientes c ON s.cliente_id = c.id
        WHERE EXISTS (SELECT 1 FROM servico_tecnicos WHERE servico_id = s.id AND tecnico_id = ?) AND s.estado = 'resolvida'
        ORDER BY s.data_hora_fim DESC
        LIMIT 50
    `;
    db.all(query, [techId], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/tecnico/stock', authenticateJWT, isTecnico, (req, res) => {
    db.all(`SELECT id, nome_produto, quantidade, codigo_barras, categoria_produto, unidade FROM produto ORDER BY nome_produto ASC`, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/tecnico/avarias/:id/preparativos', authenticateJWT, isTecnico, (req, res) => {
    const { id } = req.params;
    const techId = req.user.id;

    db.get(`SELECT EXISTS (SELECT 1 FROM avaria_tecnicos WHERE avaria_id = ? AND tecnico_id = ?) as is_assigned`, [id, techId], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row || !row.is_assigned) return res.status(403).json({ error: "Acesso negado: esta tarefa não lhe pertence." });

        const query = `
            SELECT p.id, p.produto_id, p.quantidade_levada, p.quantidade_usada, pr.nome_produto, pr.unidade 
            FROM preparativos_avaria p 
            JOIN produto pr ON p.produto_id = pr.id 
            WHERE p.avaria_id = ?
            ORDER BY pr.nome_produto ASC
        `;
        db.all(query, [id], (err, rows) => {
            if (err) return handleDBError(res, err);
            res.json(rows);
        });
    });
});

app.put('/api/tecnico/avarias/:id/preparativos', authenticateJWT, isTecnico, (req, res) => {
    const { id } = req.params;
    const techId = req.user.id;
    const items = req.body.items || [];

    db.get(`
        SELECT a.relatorio_submetido, m.cliente_id,
               EXISTS (SELECT 1 FROM avaria_tecnicos WHERE avaria_id = a.id AND tecnico_id = ?) as is_assigned
        FROM avarias a
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        WHERE a.id = ?
    `, [techId, id], (err, avaria) => {
        if (err) return handleDBError(res, err);
        if (!avaria) return res.status(404).json({ error: "Avaria não encontrada" });
        if (!avaria.is_assigned) return res.status(403).json({ error: "Acesso negado" });
        if (avaria.relatorio_submetido === 1) return res.status(400).json({ error: "O relatório já foi submetido." });

        db.all(`SELECT produto_id, quantidade_levada FROM preparativos_avaria WHERE avaria_id = ?`, [id], (err, oldItems) => {
            if (err) return handleDBError(res, err);

            const oldMap = {};
            oldItems.forEach(item => {
                oldMap[item.produto_id] = item.quantidade_levada;
            });

            const newMap = {};
            items.forEach(item => {
                const pid = parseInt(item.produto_id);
                const qty = parseFloat(item.quantidade_levada);
                if (pid && qty > 0) {
                    newMap[pid] = qty;
                }
            });

            const diffs = [];
            const allProductIds = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);

            for (const pidStr of allProductIds) {
                const pid = parseInt(pidStr);
                const oldQty = oldMap[pid] || 0;
                const newQty = newMap[pid] || 0;
                const diff = newQty - oldQty;
                if (diff !== 0) {
                    diffs.push({ produto_id: pid, diff, newQty });
                }
            }

            if (diffs.length === 0) {
                return res.json({ message: "Sem alterações nos preparativos." });
            }

            db.serialize(() => {
                let errOccurred = null;
                let completed = 0;

                const checkStmt = db.prepare(`SELECT quantidade, nome_produto FROM produto WHERE id = ?`);

                function finishChecking() {
                    checkStmt.finalize();
                    if (errOccurred) {
                        return res.status(400).json({ error: errOccurred.message });
                    }
                    performPrepUpdates();
                }

                diffs.forEach(d => {
                    checkStmt.get(d.produto_id, (err, prod) => {
                        if (err) {
                            errOccurred = err;
                        } else if (!prod && d.diff > 0) {
                            errOccurred = new Error(`Produto ID ${d.produto_id} não encontrado no stock.`);
                        } else if (prod && d.diff > 0 && prod.quantidade < d.diff) {
                            errOccurred = new Error(`Stock insuficiente para "${prod.nome_produto}". Disponível: ${prod.quantidade}, Solicitado adicional: ${d.diff}.`);
                        }
                        completed++;
                        if (completed === diffs.length) {
                            finishChecking();
                        }
                    });
                });

                if (diffs.length === 0) {
                    finishChecking();
                }

                function performPrepUpdates() {
                    db.serialize(() => {
                        let updateErr = null;
                        let updateCompleted = 0;
                        const updateStockStmt = db.prepare(`UPDATE produto SET quantidade = MAX(0, quantidade - ?) WHERE id = ?`);
                        const insertMovStmt = db.prepare(`
                            INSERT INTO movimentos_stock (produto_id, quantidade, tipo_movimento, referencia_id, cliente_id, utilizador_id, utilizador_role, data_hora)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        `);

                        function checkDone() {
                            updateCompleted++;
                            if (updateCompleted === diffs.length) {
                                updateStockStmt.finalize();
                                insertMovStmt.finalize();
                                if (updateErr) return handleDBError(res, updateErr);
                                securityLog('PREPARATIVOS_CONFIRMED', { avaria_id: id, tecnico_id: techId, item_count: items.length });
                                res.json({ message: "Preparativos confirmados e stock atualizado." });
                            }
                        }

                        diffs.forEach(d => {
                            updateStockStmt.run(d.diff, d.produto_id, (err) => {
                                if (err) {
                                    updateErr = err;
                                    checkDone();
                                    return;
                                }

                                const dateStr = new Date().toISOString();
                                const movQty = -d.diff;
                                const tipoMov = d.diff > 0 ? 'preparativo_saida' : 'preparativo_devolucao';
                                insertMovStmt.run(d.produto_id, movQty, tipoMov, id, avaria.cliente_id, techId, 'tecnico', dateStr, (err) => {
                                    if (err) {
                                        updateErr = err;
                                        checkDone();
                                        return;
                                    }

                                    if (d.newQty === 0) {
                                        db.run(`DELETE FROM preparativos_avaria WHERE avaria_id = ? AND produto_id = ?`, [id, d.produto_id], (err) => {
                                            if (err) updateErr = err;
                                            checkDone();
                                        });
                                    } else {
                                        db.get(`SELECT 1 FROM preparativos_avaria WHERE avaria_id = ? AND produto_id = ?`, [id, d.produto_id], (err, exists) => {
                                            if (err) {
                                                updateErr = err;
                                                checkDone();
                                            } else if (exists) {
                                                db.run(`UPDATE preparativos_avaria SET quantidade_levada = ? WHERE avaria_id = ? AND produto_id = ?`, [d.newQty, id, d.produto_id], (err) => {
                                                    if (err) updateErr = err;
                                                    checkDone();
                                                });
                                            } else {
                                                db.run(`INSERT INTO preparativos_avaria (avaria_id, produto_id, quantidade_levada, quantidade_usada) VALUES (?, ?, ?, 0)`, [id, d.produto_id, d.newQty], (err) => {
                                                    if (err) updateErr = err;
                                                    checkDone();
                                                });
                                            }
                                        });
                                    }
                                });
                            });
                        });
                    });
                }
            });
        });
    });
});

function parseReportParts(pecasText) {
    if (!pecasText) return [];
    const lines = pecasText.split('\n');
    const items = [];
    // Matches: 10m - Product, 1.5kg - Product, 2x - Product, 1.25 - Product, supporting commas
    const regex = /^([\d.,]+)\s*(x|m|metros|unidades|un|kg|l)?\s*-\s*(.+)$/i;

    lines.forEach(line => {
        const match = line.trim().match(regex);
        if (match) {
            const quantity = parseFloat(match[1].replace(',', '.'));
            const productName = match[3].trim();
            if (quantity > 0 && productName) {
                items.push({ quantity, productName });
            }
        }
    });
    return items;
}

function deductStockFromReportParts(pecasText, metadata, callback) {
    if (typeof metadata === 'function') {
        callback = metadata;
        metadata = {};
    }
    const items = parseReportParts(pecasText);
    if (items.length === 0) return callback(null);

    const meta = metadata || {};

    const aggregated = {};
    items.forEach(item => {
        const nameKey = item.productName.toLowerCase();
        aggregated[nameKey] = (aggregated[nameKey] || 0) + item.quantity;
    });

    db.serialize(() => {
        let errOccurred = null;
        let completed = 0;
        const keys = Object.keys(aggregated);
        const productsToCheck = [];

        const selectStmt = db.prepare(`SELECT id, nome_produto, quantidade, unidade FROM produto WHERE LOWER(nome_produto) = ?`);

        function checkProducts() {
            if (errOccurred) {
                selectStmt.finalize();
                return callback(errOccurred);
            }
            selectStmt.finalize();
            performUpdates();
        }

        keys.forEach(nameKey => {
            selectStmt.get(nameKey, (err, prod) => {
                if (err) {
                    errOccurred = err;
                } else if (!prod) {
                    // Se o produto não for encontrado no stock, ignoramos (comportamento original)
                } else if (prod.quantidade < aggregated[nameKey]) {
                    errOccurred = new Error(`Stock insuficiente para o produto "${prod.nome_produto}". Disponível: ${prod.quantidade} ${prod.unidade || 'un'}, Solicitado: ${aggregated[nameKey]} ${prod.unidade || 'un'}.`);
                    errOccurred.isStockError = true;
                } else {
                    productsToCheck.push({ id: prod.id, name: prod.nome_produto, prevQty: prod.quantidade, deductQty: aggregated[nameKey] });
                }

                completed++;
                if (completed === keys.length) {
                    checkProducts();
                }
            });
        });

        function performUpdates() {
            db.serialize(() => {
                let updateErr = null;
                let updateCompleted = 0;
                const updateStmt = db.prepare(`UPDATE produto SET quantidade = MAX(0, quantidade - ?) WHERE id = ?`);
                const insertMovStmt = db.prepare(`
                    INSERT INTO movimentos_stock (produto_id, quantidade, tipo_movimento, referencia_id, cliente_id, utilizador_id, utilizador_role, data_hora)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `);

                function checkDone() {
                    updateCompleted++;
                    if (updateCompleted === productsToCheck.length) {
                        updateStmt.finalize();
                        insertMovStmt.finalize();
                        callback(updateErr);
                    }
                }

                if (productsToCheck.length === 0) {
                    updateStmt.finalize();
                    insertMovStmt.finalize();
                    return callback(null);
                }

                productsToCheck.forEach(prod => {
                    updateStmt.run(prod.deductQty, prod.id, (err) => {
                        if (err) {
                            updateErr = err;
                            checkDone();
                        } else {
                            const newQty = Math.max(0, prod.prevQty - prod.deductQty);
                            checkAndNotifyStock(prod.id, newQty, prod.prevQty);

                            // Insert movement
                            const dateStr = new Date().toISOString();
                            insertMovStmt.run(
                                prod.id,
                                -prod.deductQty,
                                meta.tipoMovimento || 'consumo',
                                meta.refId || null,
                                meta.clienteId || null,
                                meta.userId || null,
                                meta.userRole || null,
                                dateStr,
                                (movErr) => {
                                    if (movErr) updateErr = movErr;
                                    checkDone();
                                }
                            );
                        }
                    });
                });
            });
        }
    });
}

function adjustStockFromReportPartsDifference(oldText, newText, metadata, callback) {
    if (typeof metadata === 'function') {
        callback = metadata;
        metadata = {};
    }
    const oldItems = parseReportParts(oldText);
    const newItems = parseReportParts(newText);
    const netChanges = {};
    
    const meta = metadata || {};

    oldItems.forEach(item => {
        netChanges[item.productName] = (netChanges[item.productName] || 0) - item.quantity;
    });

    newItems.forEach(item => {
        netChanges[item.productName] = (netChanges[item.productName] || 0) + item.quantity;
    });

    const itemsToUpdate = Object.entries(netChanges)
        .map(([productName, quantity]) => ({ productName, quantity }))
        .filter(item => item.quantity !== 0);

    if (itemsToUpdate.length === 0) return callback(null);

    db.serialize(() => {
        let errOccurred = null;
        let completed = 0;
        const productsToCheck = [];

        const selectStmt = db.prepare(`SELECT id, quantidade, nome_produto, unidade FROM produto WHERE LOWER(nome_produto) = LOWER(?)`);

        function checkProducts() {
            if (errOccurred) {
                selectStmt.finalize();
                return callback(errOccurred);
            }
            selectStmt.finalize();
            performUpdates();
        }

        itemsToUpdate.forEach(item => {
            selectStmt.get(item.productName, (err, prod) => {
                if (err) {
                    errOccurred = err;
                } else if (!prod) {
                    // Ignora produtos que não existem
                } else {
                    const newQty = prod.quantidade - item.quantity;
                    if (newQty < 0) {
                        errOccurred = new Error(`Stock insuficiente para o produto "${prod.nome_produto}". Disponível: ${prod.quantidade} ${prod.unidade || 'un'}, Necessário: ${item.quantity} ${prod.unidade || 'un'} adicionais.`);
                        errOccurred.isStockError = true;
                    } else {
                        productsToCheck.push({ id: prod.id, name: prod.nome_produto, prevQty: prod.quantidade, changeQty: item.quantity });
                    }
                }

                completed++;
                if (completed === itemsToUpdate.length) {
                    checkProducts();
                }
            });
        });

        function performUpdates() {
            db.serialize(() => {
                let updateErr = null;
                let updateCompleted = 0;
                const updateStmt = db.prepare(`UPDATE produto SET quantidade = MAX(0, quantidade - ?) WHERE id = ?`);
                const insertMovStmt = db.prepare(`
                    INSERT INTO movimentos_stock (produto_id, quantidade, tipo_movimento, referencia_id, cliente_id, utilizador_id, utilizador_role, data_hora)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `);

                function checkDone() {
                    updateCompleted++;
                    if (updateCompleted === productsToCheck.length) {
                        updateStmt.finalize();
                        insertMovStmt.finalize();
                        callback(updateErr);
                    }
                }

                if (productsToCheck.length === 0) {
                    updateStmt.finalize();
                    insertMovStmt.finalize();
                    return callback(null);
                }

                productsToCheck.forEach(prod => {
                    updateStmt.run(prod.changeQty, prod.id, (err) => {
                        if (err) {
                            updateErr = err;
                            checkDone();
                        } else {
                            const newQty = Math.max(0, prod.prevQty - prod.changeQty);
                            checkAndNotifyStock(prod.id, newQty, prod.prevQty);
                            
                            // Insert movement
                            const dateStr = new Date().toISOString();
                            insertMovStmt.run(
                                prod.id,
                                -prod.changeQty, // Negative if we consumed more, positive if we consumed less
                                meta.tipoMovimento || 'ajuste_consumo',
                                meta.refId || null,
                                meta.clienteId || null,
                                meta.userId || null,
                                meta.userRole || null,
                                dateStr,
                                (movErr) => {
                                    if (movErr) updateErr = movErr;
                                    checkDone();
                                }
                            );
                        }
                    });
                });
            });
        }
    });
}

// --- CONSULTA POR MÁQUINA (TÉCNICO) ---

app.get('/api/tecnico/clientes', authenticateJWT, isTecnico, (req, res) => {
    db.all(`SELECT id, nome FROM clientes ORDER BY nome ASC`, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/tecnico/clientes/:id/maquinas', authenticateJWT, isTecnico, (req, res) => {
    const { id } = req.params;
    db.all(`SELECT id, uuid, marca, modelo, numero_serie FROM maquinas WHERE cliente_id = ? ORDER BY marca ASC, modelo ASC`, [id], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.get('/api/tecnico/maquinas/:id/historico', authenticateJWT, isTecnico, (req, res) => {
    const { id } = req.params; // maquina_id (INTEGER)

    db.get(`SELECT uuid FROM maquinas WHERE id = ?`, [id], (err, maquina) => {
        if (err) return handleDBError(res, err);
        if (!maquina) return res.status(404).json({ error: 'Máquina não encontrada' });

        const uuid = maquina.uuid;

        const queryAvarias = `
            SELECT a.id, a.data_hora_fim, a.tipo_avaria, 
                   COALESCE((SELECT group_concat(t2.nome, ', ') FROM avaria_tecnicos at2 JOIN tecnicos t2 ON at2.tecnico_id = t2.id WHERE at2.avaria_id = a.id), 'Não Atribuído') as tecnico_nome, 
                   a.relatorio, c.nome as cliente_nome, 'avaria' as tipo
            FROM avarias a
            JOIN maquinas m ON a.maquina_id = m.uuid
            JOIN clientes c ON m.cliente_id = c.id
            WHERE a.maquina_id = ? AND a.estado = 'resolvida'
        `;

        const queryManutencoes = `
            SELECT m.id, m.data_hora_fim, 'Geral' as tipo_avaria, 
                   COALESCE((SELECT group_concat(t2.nome, ', ') FROM manutencao_tecnicos mt2 JOIN tecnicos t2 ON mt2.tecnico_id = t2.id WHERE mt2.manutencao_id = m.id), 'Não Atribuído') as tecnico_nome, 
                   m.relatorio, c.nome as cliente_nome, 'manutencao' as tipo
            FROM manutencoes m
            JOIN manutencao_maquinas mm ON m.id = mm.manutencao_id
            JOIN clientes c ON m.cliente_id = c.id
            WHERE mm.maquina_id = ? AND m.estado = 'resolvida'
        `;

        db.all(queryAvarias, [uuid], (err, avarias) => {
            if (err) return handleDBError(res, err);

            db.all(queryManutencoes, [id], (err, manutencoes) => {
                if (err) return handleDBError(res, err);

                const historico = [...avarias, ...manutencoes];
                historico.sort((a, b) => new Date(b.data_hora_fim) - new Date(a.data_hora_fim));

                res.json(historico);
            });
        });
    });
});

app.put('/api/tecnico/password', authenticateJWT, isTecnico, (req, res) => {
    const techId = req.user.id;
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) return res.status(400).json({ error: "Preencha a password atual e a nova password" });

    if (newPassword.length < 8) {
        return res.status(400).json({ error: "Nova password deve ter no mínimo 8 caracteres" });
    }

    db.get('SELECT password FROM tecnicos WHERE id = ?', [techId], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row || !bcrypt.compareSync(oldPassword, row.password)) {
            securityLog('PASSWORD_CHANGE_FAILED', { tecnico_id: techId, reason: 'wrong_old_password' });
            return res.status(401).json({ error: 'Password atual incorreta' });
        }

        const hashedPwd = bcrypt.hashSync(newPassword, 10);
        db.run('UPDATE tecnicos SET password = ? WHERE id = ?', [hashedPwd, techId], function (err) {
            if (err) return handleDBError(res, err);
            securityLog('PASSWORD_CHANGED', { tecnico_id: techId });
            res.json({ message: "Password atualizada com sucesso" });
        });
    });
});

// --- PUBLIC ROUTES ---

app.get('/api/public/maquinas/:uuid', authenticateJWT, (req, res) => {
    const { uuid } = req.params;

    if (!isValidUUID(uuid)) {
        return res.status(400).json({ error: "UUID inválido" });
    }

    db.get(`SELECT m.id, (m.marca || ' - ' || m.modelo) as nome, m.cliente_id FROM maquinas m WHERE m.uuid = ?`, [uuid], (err, row) => {
        if (err) return handleDBError(res, err);
        if (!row) return res.status(404).json({ error: "Máquina não encontrada" });

        if (req.user.role === 'cliente') {
            if (row.cliente_id !== req.user.cliente_id) {
                securityLog('UNAUTHORIZED_MACHINE_ACCESS', { user: req.user.id, machine_uuid: uuid });
                return res.status(403).json({ error: "Acesso negado: Esta máquina não pertence à sua lavandaria." });
            }
        }

        res.json({ nome: row.nome });
    });
});

app.post('/api/public/avarias', authenticateJWT, (req, res) => {
    const { maquina_id, tipo_avaria } = req.body;

    if (!maquina_id || !tipo_avaria) {
        return res.status(400).json({ error: "Faltam parâmetros" });
    }

    if (!isValidUUID(maquina_id)) {
        return res.status(400).json({ error: "UUID de máquina inválido" });
    }

    if (!Number.isInteger(tipo_avaria) || tipo_avaria < 1 || tipo_avaria > 10) {
        return res.status(400).json({ error: "Tipo de avaria inválido" });
    }

    db.get(`SELECT cliente_id, (marca || ' - ' || modelo) as nome FROM maquinas WHERE uuid = ?`, [maquina_id], (err, machine) => {
        if (err) return handleDBError(res, err);
        if (!machine) return res.status(404).json({ error: "Máquina não encontrada" });

        if (req.user.role === 'cliente') {
            if (machine.cliente_id !== req.user.cliente_id) {
                securityLog('UNAUTHORIZED_REPORT_ATTEMPT', { user: req.user.id, machine_uuid: maquina_id });
                return res.status(403).json({ error: "Acesso negado: Não pode reportar avarias para máquinas de outros clientes." });
            }
        }

        db.run(`INSERT INTO avarias (maquina_id, tipo_avaria) VALUES (?, ?)`,
            [maquina_id, tipo_avaria],
            function (err) {
                if (err) return handleDBError(res, err);
                const avariaId = this.lastID;
                securityLog('AVARIA_REPORTED', { id: avariaId, maquina_id, tipo_avaria, user: req.user.id });

                db.get(`SELECT nome FROM clientes WHERE id = ?`, [machine.cliente_id], (err, clientInfo) => {
                    if (!err && clientInfo) {
                        db.all(`SELECT email FROM administradores WHERE email IS NOT NULL`, [], (err, admins) => {
                            if (!err && admins.length > 0) {
                                const adminEmails = admins.map(a => a.email);
                                sendAdminNotificationEmail(adminEmails, machine.nome, clientInfo.nome, tipo_avaria);
                            }
                        });
                    }
                });

                res.status(201).json({ id: avariaId, message: "Avaria reportada" });
            });
    });
});

// --- GESTÃO DE FROTA ---

app.get('/api/frota', authenticateJWT, isAdmin, (req, res) => {
    db.all(`SELECT * FROM frota ORDER BY id DESC`, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

app.post('/api/frota', authenticateJWT, isAdmin, (req, res) => {
    let { marca, modelo, ano, data_proxima_inspecao, proxima_revisao_kms, data_ultima_revisao } = req.body;

    marca = sanitizeString(marca);
    modelo = sanitizeString(modelo);
    ano = parseInt(ano) || null;
    proxima_revisao_kms = parseInt(proxima_revisao_kms) || null;

    if (!marca || !modelo) return res.status(400).json({ error: "Marca e Modelo são obrigatórios" });

    db.run(`INSERT INTO frota (marca, modelo, ano, data_proxima_inspecao, proxima_revisao_kms, data_ultima_revisao) VALUES (?, ?, ?, ?, ?, ?)`,
        [marca, modelo, ano, data_proxima_inspecao, proxima_revisao_kms, data_ultima_revisao],
        function (err) {
            if (err) return handleDBError(res, err);
            res.status(201).json({ id: this.lastID, marca, modelo, ano });
        });
});

app.put('/api/frota/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    let { marca, modelo, ano, data_proxima_inspecao, proxima_revisao_kms, data_ultima_revisao } = req.body;

    marca = sanitizeString(marca);
    modelo = sanitizeString(modelo);
    ano = parseInt(ano) || null;
    proxima_revisao_kms = parseInt(proxima_revisao_kms) || null;

    if (!marca || !modelo) return res.status(400).json({ error: "Marca e Modelo são obrigatórios" });

    db.run(`UPDATE frota SET marca = ?, modelo = ?, ano = ?, data_proxima_inspecao = ?, proxima_revisao_kms = ?, data_ultima_revisao = ? WHERE id = ?`,
        [marca, modelo, ano, data_proxima_inspecao, proxima_revisao_kms, data_ultima_revisao, id],
        function (err) {
            if (err) return handleDBError(res, err);
            res.json({ message: "Veículo atualizado com sucesso", id, marca, modelo });
        });
});

app.delete('/api/frota/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM frota WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        res.json({ message: "Veículo removido com sucesso", id });
    });
});

// --- API: CHECKLISTS BASE DE CONHECIMENTO ---

// Listar todos os modelos únicos (marca e modelo)
app.get('/api/modelos', authenticateJWT, (req, res) => {
    const query = `
        SELECT DISTINCT marca, modelo 
        FROM maquinas 
        WHERE marca IS NOT NULL AND marca != '' AND modelo IS NOT NULL AND modelo != ''
        ORDER BY marca ASC, modelo ASC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

// Listar checklists filtrando por marca e modelo
app.get('/api/checklists', authenticateJWT, (req, res) => {
    const { marca, modelo } = req.query;
    let query = `SELECT * FROM checklists`;
    const params = [];

    if (marca && modelo) {
        query += ` WHERE marca = ? AND modelo = ?`;
        params.push(marca, modelo);
    }
    query += ` ORDER BY titulo_avaria ASC`;

    db.all(query, params, (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

// Obter uma checklist específica com os seus passos
app.get('/api/checklists/:id', authenticateJWT, (req, res) => {
    const { id } = req.params;
    db.get(`SELECT * FROM checklists WHERE id = ?`, [id], (err, checklist) => {
        if (err) return handleDBError(res, err);
        if (!checklist) return res.status(404).json({ error: 'Checklist não encontrada' });

        db.all(`SELECT * FROM checklists_passos WHERE checklist_id = ? ORDER BY ordem ASC`, [id], (err, passos) => {
            if (err) return handleDBError(res, err);
            checklist.passos = passos;
            res.json(checklist);
        });
    });
});

// Criar nova checklist (Apenas Admin)
app.post('/api/checklists', authenticateJWT, isAdmin, (req, res) => {
    const { marca, modelo, titulo_avaria, descricao, passos } = req.body;

    if (!marca || !modelo || !titulo_avaria) {
        return res.status(400).json({ error: 'Marca, modelo e título são obrigatórios' });
    }

    db.run(
        `INSERT INTO checklists (marca, modelo, titulo_avaria, descricao) VALUES (?, ?, ?, ?)`,
        [marca, modelo, titulo_avaria, descricao || ''],
        function (err) {
            if (err) return handleDBError(res, err);

            const checklistId = this.lastID;

            if (passos && Array.isArray(passos) && passos.length > 0) {
                const stmt = db.prepare(`INSERT INTO checklists_passos (checklist_id, ordem, descricao) VALUES (?, ?, ?)`);
                passos.forEach((passo, index) => {
                    stmt.run(checklistId, index + 1, passo);
                });
                stmt.finalize();
            }

            res.status(201).json({ success: true, id: checklistId, message: 'Checklist criada com sucesso' });
        }
    );
});

// Remover checklist (Apenas Admin)
app.delete('/api/checklists/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM checklists WHERE id = ?`, [id], function (err) {
        if (err) return handleDBError(res, err);
        res.json({ success: true, message: 'Checklist removida com sucesso' });
    });
});

// Editar checklist (Apenas Admin)
app.put('/api/checklists/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    const { marca, modelo, titulo_avaria, descricao, passos } = req.body;

    if (!marca || !modelo || !titulo_avaria) {
        return res.status(400).json({ error: 'Marca, modelo e título são obrigatórios' });
    }

    db.run(
        `UPDATE checklists SET marca = ?, modelo = ?, titulo_avaria = ?, descricao = ? WHERE id = ?`,
        [marca, modelo, titulo_avaria, descricao || '', id],
        function (err) {
            if (err) return handleDBError(res, err);

            db.run(`DELETE FROM checklists_passos WHERE checklist_id = ?`, [id], function (err) {
                if (err) return handleDBError(res, err);

                if (passos && Array.isArray(passos) && passos.length > 0) {
                    const stmt = db.prepare(`INSERT INTO checklists_passos (checklist_id, ordem, descricao) VALUES (?, ?, ?)`);
                    passos.forEach((passo, index) => {
                        stmt.run(id, index + 1, passo);
                    });
                    stmt.finalize();
                }
                res.json({ success: true, message: 'Checklist atualizada com sucesso' });
            });
        }
    );
});

// --- ANOTAÇÕES / CHECKLIST FUTURA ---

// Técnico: Criar nova anotação
app.post('/api/tecnico/anotacoes', authenticateJWT, isTecnico, (req, res) => {
    const tecnico_id = req.user.id;
    const { cliente_id, maquina_id, descricao } = req.body;

    if (!cliente_id || !descricao) {
        return res.status(400).json({ error: "Cliente e descrição são obrigatórios." });
    }

    db.run(
        `INSERT INTO anotacoes_tecnicos (tecnico_id, cliente_id, maquina_id, descricao) VALUES (?, ?, ?, ?)`,
        [tecnico_id, cliente_id, maquina_id || null, descricao],
        function (err) {
            if (err) return handleDBError(res, err);
            res.status(201).json({ success: true, id: this.lastID });
        }
    );
});

// Técnico: Obter histórico de anotações
app.get('/api/tecnico/anotacoes', authenticateJWT, isTecnico, (req, res) => {
    const tecnico_id = req.user.id;
    
    const query = `
        SELECT a.*, c.nome as cliente_nome, m.marca, m.modelo
        FROM anotacoes_tecnicos a
        JOIN clientes c ON a.cliente_id = c.id
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        WHERE a.tecnico_id = ?
        ORDER BY a.data_criacao DESC
    `;
    
    db.all(query, [tecnico_id], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

// Admin: Obter todas as anotações
app.get('/api/admin/anotacoes', authenticateJWT, isAdmin, (req, res) => {
    const query = `
        SELECT a.*, c.nome as cliente_nome, t.nome as tecnico_nome, m.marca, m.modelo
        FROM anotacoes_tecnicos a
        JOIN clientes c ON a.cliente_id = c.id
        JOIN tecnicos t ON a.tecnico_id = t.id
        LEFT JOIN maquinas m ON a.maquina_id = m.uuid
        ORDER BY c.nome ASC, a.data_criacao DESC
    `;
    
    db.all(query, [], (err, rows) => {
        if (err) return handleDBError(res, err);
        res.json(rows);
    });
});

// Admin: Marcar anotação como concluída
app.put('/api/admin/anotacoes/:id', authenticateJWT, isAdmin, (req, res) => {
    const { id } = req.params;
    
    db.run(`UPDATE anotacoes_tecnicos SET estado = 'concluida' WHERE id = ?`, [id], function(err) {
        if (err) return handleDBError(res, err);
        res.json({ success: true });
    });
});

// Error Handler Global
app.use((err, req, res, next) => {
    console.error('[SERVER ERROR]', err);
    securityLog('UNHANDLED_ERROR', { error: err.message, path: req.path });
    res.status(500).json({ error: "Ocorreu um erro interno no servidor." });
});

app.listen(PORT, () => {
    console.log(`🚀 Maclau SERVER v3.0 SECURE is running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔐 Security: CORS, Helmet, Rate Limiting, JWT Expiration ENABLED`);

    // As rotinas checkVehicleInspections() e generateUpcomingMaintenances() correm
    // automaticamente assim que a base de dados concluir a sua inicialização.
    scheduleDailyCheck();     // Agenda para correr todos os dias às 08:00 (sem double-fire)
});
