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

// --- 4. Inicialización de Tablas (SIMPLE, como la que funciona) ---
const initDB = async () => {
    try {
        // Tabla perfiles
        await pool.query(`
            CREATE TABLE IF NOT EXISTS perfiles (
                id SERIAL PRIMARY KEY,
                strNombrePerfil VARCHAR(100) UNIQUE NOT NULL,
                bitAdministrador BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tabla modulos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS modulos (
                id SERIAL PRIMARY KEY,
                strNombreModulo VARCHAR(100) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tabla usuarios
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                strNombreUsuario VARCHAR(100) UNIQUE NOT NULL,
                idPerfil INTEGER REFERENCES perfiles(id),
                strPwd VARCHAR(255) NOT NULL,
                idEstadoUsuario INTEGER DEFAULT 1,
                strCorreo VARCHAR(255) UNIQUE NOT NULL,
                strNumeroCelular VARCHAR(20),
                strImagen TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

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

        // Tabla menu
        await pool.query(`
            CREATE TABLE IF NOT EXISTS menu (
                id SERIAL PRIMARY KEY,
                idMenu INTEGER NOT NULL,
                idModulo INTEGER REFERENCES modulos(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

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

        console.log('✅ Base de datos inicializada');
    } catch (err) {
        console.error('❌ Error iniciando DB:', err);
    }
};

// Ejecutar initDB (sin await, sin promesas complejas)
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

// --- 6. Rutas de Autenticación (MODIFICADA para que el primer usuario sea admin) ---
app.post('/api/register', async (req, res) => {
    try {
        const { strNombreUsuario, strCorreo, strPwd, strNumeroCelular } = req.body;
        
        if (!strPwd || strPwd.length < 6) {
            return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 6 caracteres' });
        }

        const hashedPassword = await bcrypt.hash(strPwd, 10);
        
        // Verificar si es el primer usuario
        const userCount = await pool.query('SELECT COUNT(*) FROM usuarios');
        const esPrimerUsuario = parseInt(userCount.rows[0].count) === 0;
        
        let idPerfil = null;
        
        if (esPrimerUsuario) {
            console.log('👑 Primer usuario - será administrador');
            
            // Crear perfil administrador
            const perfilResult = await pool.query(
                `INSERT INTO perfiles (strNombrePerfil, bitAdministrador) 
                 VALUES ('Administrador', true) 
                 ON CONFLICT (strNombrePerfil) DO UPDATE SET bitAdministrador = true
                 RETURNING id`
            );
            idPerfil = perfilResult.rows[0].id;
            
            // Crear permisos para todos los módulos
            const modulos = await pool.query('SELECT id FROM modulos');
            for (const modulo of modulos.rows) {
                await pool.query(`
                    INSERT INTO permisos_perfil (idModulo, idPerfil, bitAgregar, bitEditar, bitConsulta, bitEliminar, bitDetalle)
                    VALUES ($1, $2, true, true, true, true, true)
                    ON CONFLICT (idModulo, idPerfil) DO NOTHING
                `, [modulo.id, idPerfil]);
            }
        }

        const result = await pool.query(
            'INSERT INTO usuarios (strNombreUsuario, strCorreo, strPwd, strNumeroCelular, idEstadoUsuario, idPerfil) VALUES ($1, $2, $3, $4, 1, $5) RETURNING id, strNombreUsuario, strCorreo',
            [strNombreUsuario, strCorreo.toLowerCase(), hashedPassword, strNumeroCelular, idPerfil]
        );

        res.status(201).json({ 
            success: true, 
            message: esPrimerUsuario ? 'Usuario administrador creado' : 'Usuario registrado', 
            user: result.rows[0] 
        });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ success: false, message: 'El email o usuario ya existe' });
        }
        console.error('Error en registro:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const result = await pool.query(
            `SELECT u.*, p.strNombrePerfil, p.bitAdministrador 
             FROM usuarios u 
             LEFT JOIN perfiles p ON u.idPerfil = p.id 
             WHERE u.strNombreUsuario = $1 OR u.strCorreo = $1`,
            [username.toLowerCase()]
        );

        if (result.rows.length === 0 || !(await bcrypt.compare(password, result.rows[0].strpwd))) {
            return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
        }

        const user = result.rows[0];
        
        if (user.idestadousuario !== 1) {
            return res.status(401).json({ success: false, message: 'Usuario inactivo' });
        }

        const permisos = await pool.query(
            `SELECT m.strNombreModulo, pp.* 
             FROM permisos_perfil pp
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
                username: user.strnombreusuario,
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

// --- 7. CRUD Perfiles (todos igual que antes) ---
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

app.get('/api/perfiles/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM perfiles WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Perfil no encontrado' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al obtener perfil' });
    }
});

app.post('/api/perfiles', authenticateToken, async (req, res) => {
    try {
        const { strNombrePerfil, bitAdministrador } = req.body;
        
        const result = await pool.query(
            'INSERT INTO perfiles (strNombrePerfil, bitAdministrador) VALUES ($1, $2) RETURNING *',
            [strNombrePerfil, bitAdministrador || false]
        );
        
        res.status(201).json({ success: true, message: 'Perfil creado', data: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ success: false, message: 'El nombre del perfil ya existe' });
        }
        res.status(500).json({ success: false, message: 'Error al crear perfil' });
    }
});

app.put('/api/perfiles/:id', authenticateToken, async (req, res) => {
    try {
        const { strNombrePerfil, bitAdministrador } = req.body;
        
        const result = await pool.query(
            'UPDATE perfiles SET strNombrePerfil = $1, bitAdministrador = $2 WHERE id = $3 RETURNING *',
            [strNombrePerfil, bitAdministrador, req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Perfil no encontrado' });
        }
        
        res.json({ success: true, message: 'Perfil actualizado', data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al actualizar perfil' });
    }
});

app.delete('/api/perfiles/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM perfiles WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Perfil no encontrado' });
        }
        res.json({ success: true, message: 'Perfil eliminado' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al eliminar perfil' });
    }
});

// --- 8. CRUD Módulos (todos igual) ---
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

app.get('/api/modulos/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM modulos WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Módulo no encontrado' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al obtener módulo' });
    }
});

app.post('/api/modulos', authenticateToken, async (req, res) => {
    try {
        const { strNombreModulo } = req.body;
        
        const result = await pool.query(
            'INSERT INTO modulos (strNombreModulo) VALUES ($1) RETURNING *',
            [strNombreModulo]
        );
        
        res.status(201).json({ success: true, message: 'Módulo creado', data: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ success: false, message: 'El nombre del módulo ya existe' });
        }
        res.status(500).json({ success: false, message: 'Error al crear módulo' });
    }
});

app.put('/api/modulos/:id', authenticateToken, async (req, res) => {
    try {
        const { strNombreModulo } = req.body;
        
        const result = await pool.query(
            'UPDATE modulos SET strNombreModulo = $1 WHERE id = $2 RETURNING *',
            [strNombreModulo, req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Módulo no encontrado' });
        }
        
        res.json({ success: true, message: 'Módulo actualizado', data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al actualizar módulo' });
    }
});

app.delete('/api/modulos/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM modulos WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Módulo no encontrado' });
        }
        res.json({ success: true, message: 'Módulo eliminado' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al eliminar módulo' });
    }
});

// --- 9. CRUD Usuarios (con imagen Base64) ---
app.get('/api/usuarios', authenticateToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 5;
        const offset = (page - 1) * limit;
        
        const totalResult = await pool.query('SELECT COUNT(*) FROM usuarios');
        const total = parseInt(totalResult.rows[0].count);
        
        const result = await pool.query(
            `SELECT u.*, p.strNombrePerfil 
             FROM usuarios u
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
        res.status(500).json({ success: false, message: 'Error al obtener usuarios' });
    }
});

app.get('/api/usuarios/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.*, p.strNombrePerfil 
             FROM usuarios u
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
            strNombreUsuario, 
            idPerfil, 
            strPwd, 
            idEstadoUsuario, 
            strCorreo, 
            strNumeroCelular,
            strImagenBase64 
        } = req.body;
        
        if (!strNombreUsuario || !strCorreo || !strPwd) {
            return res.status(400).json({ success: false, message: 'Campos requeridos incompletos' });
        }
        
        const hashedPassword = await bcrypt.hash(strPwd, 10);
        
        const result = await pool.query(
            `INSERT INTO usuarios (strNombreUsuario, idPerfil, strPwd, idEstadoUsuario, strCorreo, strNumeroCelular, strImagen) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [strNombreUsuario, idPerfil || null, hashedPassword, idEstadoUsuario || 1, strCorreo.toLowerCase(), strNumeroCelular, strImagenBase64 || null]
        );
        
        res.status(201).json({ success: true, message: 'Usuario creado', data: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ success: false, message: 'El email o usuario ya existe' });
        }
        res.status(500).json({ success: false, message: 'Error al crear usuario' });
    }
});

app.put('/api/usuarios/:id', authenticateToken, async (req, res) => {
    try {
        const { 
            strNombreUsuario, 
            idPerfil, 
            idEstadoUsuario, 
            strCorreo, 
            strNumeroCelular,
            strImagenBase64 
        } = req.body;
        
        let query = 'UPDATE usuarios SET strNombreUsuario = $1, idPerfil = $2, idEstadoUsuario = $3, strCorreo = $4, strNumeroCelular = $5';
        const params = [strNombreUsuario, idPerfil, idEstadoUsuario, strCorreo.toLowerCase(), strNumeroCelular];
        
        if (strImagenBase64) {
            query += ', strImagen = $6';
            params.push(strImagenBase64);
        }
        
        query += ' WHERE id = $' + (params.length + 1) + ' RETURNING *';
        params.push(req.params.id);
        
        const result = await pool.query(query, params);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
        
        res.json({ success: true, message: 'Usuario actualizado', data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al actualizar usuario' });
    }
});

app.delete('/api/usuarios/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM usuarios WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }
        res.json({ success: true, message: 'Usuario eliminado' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al eliminar usuario' });
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

app.get('/api/permisos-perfil/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT pp.*, m.strNombreModulo, p.strNombrePerfil 
             FROM permisos_perfil pp
             JOIN modulos m ON pp.idModulo = m.id
             JOIN perfiles p ON pp.idPerfil = p.id
             WHERE pp.id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Permiso no encontrado' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al obtener permiso' });
    }
});

app.post('/api/permisos-perfil', authenticateToken, async (req, res) => {
    try {
        const { idModulo, idPerfil, bitAgregar, bitEditar, bitConsulta, bitEliminar, bitDetalle } = req.body;
        
        const result = await pool.query(
            `INSERT INTO permisos_perfil (idModulo, idPerfil, bitAgregar, bitEditar, bitConsulta, bitEliminar, bitDetalle) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [idModulo, idPerfil, bitAgregar || false, bitEditar || false, bitConsulta || false, bitEliminar || false, bitDetalle || false]
        );
        
        res.status(201).json({ success: true, message: 'Permiso creado', data: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ success: false, message: 'Ya existe un permiso para este módulo y perfil' });
        }
        res.status(500).json({ success: false, message: 'Error al crear permiso' });
    }
});

app.put('/api/permisos-perfil/:id', authenticateToken, async (req, res) => {
    try {
        const { idModulo, idPerfil, bitAgregar, bitEditar, bitConsulta, bitEliminar, bitDetalle } = req.body;
        
        const result = await pool.query(
            `UPDATE permisos_perfil SET idModulo = $1, idPerfil = $2, bitAgregar = $3, bitEditar = $4, bitConsulta = $5, bitEliminar = $6, bitDetalle = $7 
             WHERE id = $8 RETURNING *`,
            [idModulo, idPerfil, bitAgregar, bitEditar, bitConsulta, bitEliminar, bitDetalle, req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Permiso no encontrado' });
        }
        
        res.json({ success: true, message: 'Permiso actualizado', data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al actualizar permiso' });
    }
});

app.delete('/api/permisos-perfil/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM permisos_perfil WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Permiso no encontrado' });
        }
        res.json({ success: true, message: 'Permiso eliminado' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al eliminar permiso' });
    }
});

// --- 11. Endpoint para menú dinámico ---
app.get('/api/menu', authenticateToken, async (req, res) => {
    try {
        const userResult = await pool.query('SELECT idPerfil FROM usuarios WHERE id = $1', [req.userId]);
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
    console.log('📝 IMPORTANTE:');
    console.log('   El PRIMER usuario registrado será ADMINISTRADOR');
    console.log('   con todos los permisos automáticamente');
    console.log('='.repeat(50));
});