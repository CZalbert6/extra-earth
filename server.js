import express from 'express';
import cors from 'cors';
import pkg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

const { Pool } = pkg;
const app = express();

// --- 1. Configuración de Middlewares ---
app.use(cors({
    origin: [
        'https://extra-earth-production.up.railway.app',
        'https://czalbert6.github.io',
        'http://localhost:4321'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// --- 2. Conexión a Base de Datos ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'secreto_super_seguro_2026';

// --- 3. Health Check ---
app.get('/', (req, res) => res.status(200).send('OK'));
app.get('/health', (req, res) => res.status(200).send('OK'));

// --- 4. Inicialización de Tablas ---
const initDB = async () => {
    try {
        // --- ELIMINAR TABLA VIEJA (SOLO UNA VEZ) ---
        await pool.query(`DROP TABLE IF EXISTS usuarios CASCADE;`);
        console.log('🗑️ Tabla antigua usuarios eliminada');
        
        // Tabla perfiles
        await pool.query(`
            CREATE TABLE IF NOT EXISTS perfiles (
                id SERIAL PRIMARY KEY,
                strNombrePerfil VARCHAR(100) UNIQUE NOT NULL,
                bitAdministrador BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Tabla perfiles creada');

        // Tabla modulos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS modulos (
                id SERIAL PRIMARY KEY,
                strNombreModulo VARCHAR(100) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Tabla modulos creada');

        // Tabla usuarios1 - AHORA ES LA ÚNICA TABLA DE USUARIOS
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios1 (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                nombre VARCHAR(100) NOT NULL,
                sername VARCHAR(100),
                password VARCHAR(255) NOT NULL,
                idPerfil INTEGER REFERENCES perfiles(id),
                idEstadoUsuario INTEGER DEFAULT 1,
                strNumeroCelular VARCHAR(20),
                strImagen TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Tabla usuarios1 creada');

        // Tabla permisos_perfil
        await pool.query(`
            CREATE TABLE IF NOT EXISTS permisos_perfil (
                id SERIAL PRIMARY KEY,
                idModulo INTEGER REFERENCES modulos(id) ON DELETE CASCADE,
                idPerfil INTEGER REFERENCES perfiles(id) ON DELETE CASCADE,
                bitAgregar BOOLEAN DEFAULT false,
                bitEditar BOOLEAN DEFAULT false,
                bitConsulta BOOLEAN DEFAULT false,
                bitEliminar BOOLEAN DEFAULT false,
                bitDetalle BOOLEAN DEFAULT false,
                UNIQUE(idModulo, idPerfil)
            )
        `);
        console.log('✅ Tabla permisos_perfil creada');

        // Tabla menu
        await pool.query(`
            CREATE TABLE IF NOT EXISTS menu (
                id SERIAL PRIMARY KEY,
                idMenu INTEGER NOT NULL,
                idModulo INTEGER REFERENCES modulos(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Tabla menu creada');

        // Insertar módulos iniciales
        const modulosIniciales = [
            'Perfil', 'Módulo', 'Permisos-Perfil', 'Usuario',
            'Principal 1.1', 'Principal 1.2', 'Principal 2.1', 'Principal 2.2'
        ];
        
        for (const modulo of modulosIniciales) {
            await pool.query(
                'INSERT INTO modulos (strNombreModulo) VALUES ($1) ON CONFLICT (strNombreModulo) DO NOTHING',
                [modulo]
            );
        }
        console.log('✅ Módulos iniciales insertados');

        // Insertar menú inicial
        const menuItems = [
            { idMenu: 1, nombreModulo: 'Perfil' },
            { idMenu: 1, nombreModulo: 'Módulo' },
            { idMenu: 1, nombreModulo: 'Permisos-Perfil' },
            { idMenu: 1, nombreModulo: 'Usuario' },
            { idMenu: 2, nombreModulo: 'Principal 1.1' },
            { idMenu: 2, nombreModulo: 'Principal 1.2' },
            { idMenu: 3, nombreModulo: 'Principal 2.1' },
            { idMenu: 3, nombreModulo: 'Principal 2.2' }
        ];

        for (const item of menuItems) {
            const modulo = await pool.query('SELECT id FROM modulos WHERE strNombreModulo = $1', [item.nombreModulo]);
            if (modulo.rows[0]) {
                await pool.query(
                    'INSERT INTO menu (idMenu, idModulo) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [item.idMenu, modulo.rows[0].id]
                );
            }
        }
        console.log('✅ Menú inicial insertado');

        console.log('✅ Base de datos inicializada con usuarios1 como única tabla');
    } catch (err) {
        console.error('❌ Error iniciando DB:', err);
    }
};

initDB();

// --- 5. Middleware de autenticación ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ success: false, message: 'Token requerido' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, message: 'Token inválido' });
        req.userId = user.id;
        next();
    });
};

// --- 6. Rutas de Autenticación ---
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, nombre, sername, password } = req.body;
        
        // Validaciones
        if (!username || !email || !nombre || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Faltan campos requeridos: username, email, nombre y password son obligatorios' 
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'La contraseña debe tener al menos 6 caracteres' 
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Verificar si es el primer usuario
        const userCount = await pool.query('SELECT COUNT(*) FROM usuarios1');
        const esPrimerUsuario = parseInt(userCount.rows[0].count) === 0;
        
        let idPerfil = null;
        
        if (esPrimerUsuario) {
            console.log('👑 Primer usuario - será administrador');
            
            const perfilResult = await pool.query(
                `INSERT INTO perfiles (strNombrePerfil, bitAdministrador) 
                 VALUES ('Administrador', true) 
                 ON CONFLICT (strNombrePerfil) DO UPDATE SET bitAdministrador = true
                 RETURNING id`
            );
            idPerfil = perfilResult.rows[0].id;
            
            const modulos = await pool.query('SELECT id FROM modulos');
            for (const modulo of modulos.rows) {
                await pool.query(`
                    INSERT INTO permisos_perfil (idModulo, idPerfil, bitAgregar, bitEditar, bitConsulta, bitEliminar, bitDetalle)
                    VALUES ($1, $2, true, true, true, true, true)
                    ON CONFLICT (idModulo, idPerfil) DO NOTHING
                `, [modulo.id, idPerfil]);
            }
        }

        // Insertar en usuarios1
        const result = await pool.query(
            `INSERT INTO usuarios1 (username, email, nombre, sername, password, idPerfil, idEstadoUsuario) 
             VALUES ($1, $2, $3, $4, $5, $6, 1) 
             RETURNING id, username, email, nombre, sername`,
            [username.toLowerCase(), email.toLowerCase(), nombre, sername || null, hashedPassword, idPerfil]
        );

        res.status(201).json({ 
            success: true, 
            message: esPrimerUsuario ? 'Usuario administrador creado' : 'Usuario registrado', 
            user: result.rows[0] 
        });
    } catch (err) {
        if (err.code === '23505') {
            if (err.constraint === 'usuarios1_username_key') {
                return res.status(400).json({ success: false, message: 'El nombre de usuario ya existe' });
            } else if (err.constraint === 'usuarios1_email_key') {
                return res.status(400).json({ success: false, message: 'El email ya existe' });
            }
            return res.status(400).json({ success: false, message: 'El email o usuario ya existe' });
        }
        console.error('Error en registro:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Consultar en usuarios1
        const result = await pool.query(
            `SELECT u.*, p.strNombrePerfil, p.bitAdministrador 
             FROM usuarios1 u 
             LEFT JOIN perfiles p ON u.idPerfil = p.id 
             WHERE LOWER(u.username) = LOWER($1) OR LOWER(u.email) = LOWER($1)`,
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
        }

        const user = result.rows[0];
        
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
        }
        
        if (user.idestadousuario !== 1) {
            return res.status(401).json({ success: false, message: 'Usuario inactivo' });
        }

        const permisos = await pool.query(
            `SELECT m.strNombreModulo, pp.* FROM permisos_perfil pp
             JOIN modulos m ON pp.idModulo = m.id
             WHERE pp.idPerfil = $1`,
            [user.idperfil]
        );

        const token = jwt.sign({ id: user.id, idPerfil: user.idperfil }, JWT_SECRET, { expiresIn: '7d' });

        res.json({ 
            success: true, 
            token, 
            user: { 
                id: user.id, 
                username: user.username,
                email: user.email,
                nombre: user.nombre,
                sername: user.sername,
                idPerfil: user.idperfil,
                esAdmin: user.bitadministrador,
                strImagen: user.strimagen
            },
            permisos: permisos.rows
        });
    } catch (err) {
        console.error('Error en login:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// --- 7. CRUD Perfiles ---
app.get('/api/perfiles', authenticateToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 5;
        const offset = (page - 1) * limit;
        
        const totalResult = await pool.query('SELECT COUNT(*) FROM perfiles');
        const total = parseInt(totalResult.rows[0].count);
        
        const result = await pool.query(
            'SELECT * FROM perfiles ORDER BY id LIMIT $1 OFFSET $2',
            [limit, offset]
        );
        
        res.json({
            success: true,
            data: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al obtener perfiles' });
    }
});

// --- 8. CRUD Módulos ---
app.get('/api/modulos', authenticateToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 5;
        const offset = (page - 1) * limit;
        
        const totalResult = await pool.query('SELECT COUNT(*) FROM modulos');
        const total = parseInt(totalResult.rows[0].count);
        
        const result = await pool.query(
            'SELECT * FROM modulos ORDER BY id LIMIT $1 OFFSET $2',
            [limit, offset]
        );
        
        res.json({
            success: true,
            data: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al obtener módulos' });
    }
});

// --- 9. CRUD Usuarios1 (renombrado a /api/usuarios) ---
app.get('/api/usuarios', authenticateToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 5;
        const offset = (page - 1) * limit;
        
        const totalResult = await pool.query('SELECT COUNT(*) FROM usuarios1');
        const total = parseInt(totalResult.rows[0].count);
        
        const result = await pool.query(
            `SELECT u.id, u.username, u.email, u.nombre, u.sername, 
                    u.idPerfil, u.idEstadoUsuario, u.strNumeroCelular, 
                    u.strImagen, u.created_at,
                    p.strNombrePerfil 
             FROM usuarios1 u
             LEFT JOIN perfiles p ON u.idPerfil = p.id
             ORDER BY u.id LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        
        res.json({
            success: true,
            data: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Error al obtener usuarios:', err);
        res.status(500).json({ success: false, message: 'Error al obtener usuarios' });
    }
});

app.get('/api/usuarios/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id, u.username, u.email, u.nombre, u.sername, 
                    u.idPerfil, u.idEstadoUsuario, u.strNumeroCelular, 
                    u.strImagen, u.created_at,
                    p.strNombrePerfil 
             FROM usuarios1 u
             LEFT JOIN perfiles p ON u.idPerfil = p.id
             WHERE u.id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al obtener usuario' });
    }
});

app.post('/api/usuarios', authenticateToken, async (req, res) => {
    try {
        const { 
            username, email, nombre, sername, password, 
            idPerfil, idEstadoUsuario, strNumeroCelular, strImagenBase64 
        } = req.body;
        
        if (!username || !email || !nombre || !password) {
            return res.status(400).json({ 
                success: false, message: 'Campos requeridos: username, email, nombre y password' 
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            `INSERT INTO usuarios1 (username, email, nombre, sername, password, idPerfil, idEstadoUsuario, strNumeroCelular, strImagen) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
             RETURNING id, username, email, nombre, sername`,
            [
                username.toLowerCase(), email.toLowerCase(), nombre, sername || null, 
                hashedPassword, idPerfil || null, idEstadoUsuario || 1, 
                strNumeroCelular || null, strImagenBase64 || null
            ]
        );
        
        res.status(201).json({ success: true, message: 'Usuario creado', data: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            if (err.constraint === 'usuarios1_username_key') {
                return res.status(400).json({ success: false, message: 'El nombre de usuario ya existe' });
            } else if (err.constraint === 'usuarios1_email_key') {
                return res.status(400).json({ success: false, message: 'El email ya existe' });
            }
        }
        console.error('Error al crear usuario:', err);
        res.status(500).json({ success: false, message: 'Error al crear usuario' });
    }
});

app.put('/api/usuarios/:id', authenticateToken, async (req, res) => {
    try {
        const { 
            username, email, nombre, sername, 
            idPerfil, idEstadoUsuario, strNumeroCelular, strImagenBase64 
        } = req.body;
        
        let query = 'UPDATE usuarios1 SET username = $1, email = $2, nombre = $3, sername = $4, idPerfil = $5, idEstadoUsuario = $6, strNumeroCelular = $7';
        const params = [username.toLowerCase(), email.toLowerCase(), nombre, sername, idPerfil, idEstadoUsuario, strNumeroCelular];
        
        let paramIndex = 8;
        
        if (strImagenBase64) {
            query += ', strImagen = $' + paramIndex;
            params.push(strImagenBase64);
            paramIndex++;
        }
        
        query += ' WHERE id = $' + paramIndex + ' RETURNING id, username, email, nombre, sername';
        params.push(req.params.id);
        
        const result = await pool.query(query, params);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
        
        res.json({ success: true, message: 'Usuario actualizado', data: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            if (err.constraint === 'usuarios1_username_key') {
                return res.status(400).json({ success: false, message: 'El nombre de usuario ya existe' });
            } else if (err.constraint === 'usuarios1_email_key') {
                return res.status(400).json({ success: false, message: 'El email ya existe' });
            }
        }
        console.error('Error al actualizar usuario:', err);
        res.status(500).json({ success: false, message: 'Error al actualizar usuario' });
    }
});

app.delete('/api/usuarios/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM usuarios1 WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
        res.json({ success: true, message: 'Usuario eliminado' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al eliminar usuario' });
    }
});

// Endpoint para cambiar contraseña
app.put('/api/usuarios/:id/password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        const userResult = await pool.query('SELECT password FROM usuarios1 WHERE id = $1', [req.params.id]);
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
        
        const passwordMatch = await bcrypt.compare(currentPassword, userResult.rows[0].password);
        if (!passwordMatch) {
            return res.status(401).json({ success: false, message: 'Contraseña actual incorrecta' });
        }
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE usuarios1 SET password = $1 WHERE id = $2', [hashedPassword, req.params.id]);
        
        res.json({ success: true, message: 'Contraseña actualizada' });
    } catch (err) {
        console.error('Error al cambiar contraseña:', err);
        res.status(500).json({ success: false, message: 'Error al cambiar contraseña' });
    }
});

// --- 10. CRUD Permisos-Perfil ---
app.get('/api/permisos-perfil', authenticateToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 5;
        const offset = (page - 1) * limit;
        
        const totalResult = await pool.query('SELECT COUNT(*) FROM permisos_perfil');
        const total = parseInt(totalResult.rows[0].count);
        
        const result = await pool.query(
            `SELECT pp.*, m.strNombreModulo, p.strNombrePerfil 
             FROM permisos_perfil pp
             JOIN modulos m ON pp.idModulo = m.id
             JOIN perfiles p ON pp.idPerfil = p.id
             ORDER BY pp.id LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        
        res.json({
            success: true,
            data: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al obtener permisos' });
    }
});

// --- 11. Endpoint para menú dinámico ---
app.get('/api/menu', authenticateToken, async (req, res) => {
    try {
        const userResult = await pool.query('SELECT idPerfil FROM usuarios1 WHERE id = $1', [req.userId]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
        
        const idPerfil = userResult.rows[0].idperfil;
        
        const menuResult = await pool.query(
            `SELECT DISTINCT m.idMenu, mod.id as idModulo, mod.strNombreModulo, 
                    pp.bitAgregar, pp.bitEditar, pp.bitConsulta, pp.bitEliminar, pp.bitDetalle
             FROM menu m
             JOIN modulos mod ON m.idModulo = mod.id
             LEFT JOIN permisos_perfil pp ON pp.idModulo = mod.id AND pp.idPerfil = $1
             WHERE pp.id IS NOT NULL 
               AND (pp.bitAgregar OR pp.bitEditar OR pp.bitConsulta OR pp.bitEliminar OR pp.bitDetalle)
             ORDER BY m.idMenu, mod.id`,
            [idPerfil]
        );
        
        const menuOrganizado = {
            1: { nombre: 'Seguridad', modulos: [] },
            2: { nombre: 'Principal 1', modulos: [] },
            3: { nombre: 'Principal 2', modulos: [] }
        };
        
        menuResult.rows.forEach(item => {
            if (menuOrganizado[item.idmenu]) {
                menuOrganizado[item.idmenu].modulos.push({
                    id: item.idmodulo,
                    nombre: item.strnombremodulo,
                    permisos: {
                        agregar: item.bitagregar,
                        editar: item.biteditar,
                        consulta: item.bitconsulta,
                        eliminar: item.biteliminar,
                        detalle: item.bitdetalle
                    }
                });
            }
        });
        
        res.json({ success: true, data: menuOrganizado });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al obtener menú' });
    }
});

// --- 12. Endpoints para selects ---
app.get('/api/perfiles-lista', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, strNombrePerfil FROM perfiles ORDER BY strNombrePerfil');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al obtener perfiles' });
    }
});

app.get('/api/modulos-lista', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, strNombreModulo FROM modulos ORDER BY strNombreModulo');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al obtener módulos' });
    }
});

// --- 13. Iniciar servidor ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(50));
    console.log(`✅ SERVIDOR INICIADO CORRECTAMENTE`);
    console.log(`📡 Puerto: ${PORT}`);
    console.log('='.repeat(50));
    console.log('🗑️ TABLA ANTIGUA ELIMINADA - Solo existe usuarios1');
    console.log('📝 ESTRUCTURA DE USUARIOS (usuarios1):');
    console.log('   - username: nombre de usuario');
    console.log('   - email: correo electrónico');
    console.log('   - nombre: nombre real');
    console.log('   - sername: apellido (opcional)');
    console.log('   - password: contraseña encriptada');
    console.log('='.repeat(50));
    console.log('👑 El PRIMER usuario registrado será ADMINISTRADOR');
    console.log('='.repeat(50));
});