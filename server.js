import express from 'express';
import cors from 'cors';
import pkg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const { Pool } = pkg;
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 1. Middlewares ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'dist'))); 

// --- 2. Conexión a Postgres ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'secreto_super_seguro_2026';
const H_SECRET = "0x0000000000000000000000000000000000000000"; // hCaptcha prueba

// --- 3. Inicialización DB y Administrador ---
const initDB = async () => {
    try {
        // Crear las tablas del proyecto corporativo
        await pool.query(`
            CREATE TABLE IF NOT EXISTS perfil (
                id SERIAL PRIMARY KEY,
                strNombrePerfil VARCHAR(100),
                bitAdministrador BOOLEAN DEFAULT FALSE
            );
            CREATE TABLE IF NOT EXISTS modulo (
                id SERIAL PRIMARY KEY,
                strNombreModulo VARCHAR(100)
            );
            CREATE TABLE IF NOT EXISTS usuario (
                id SERIAL PRIMARY KEY,
                strNombreUsuario VARCHAR(100) UNIQUE,
                idPerfil INTEGER REFERENCES perfil(id),
                strPwd VARCHAR(255) NOT NULL,
                idEstadoUsuario VARCHAR(20) DEFAULT 'activo',
                strCorreo VARCHAR(255),
                strNumeroCelular VARCHAR(20),
                urlImagen TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS permisos_perfil (
                id SERIAL PRIMARY KEY,
                idModulo INTEGER REFERENCES modulo(id),
                idPerfil INTEGER REFERENCES perfil(id),
                bitAgregar BOOLEAN DEFAULT FALSE, bitEditar BOOLEAN DEFAULT FALSE,
                bitConsulta BOOLEAN DEFAULT FALSE, bitEliminar BOOLEAN DEFAULT FALSE,
                bitDetalle BOOLEAN DEFAULT FALSE
            );
            CREATE TABLE IF NOT EXISTS menu (
                id SERIAL PRIMARY KEY, idMenu VARCHAR(50), idModulo INTEGER REFERENCES modulo(id)
            );
        `);

        // Insertar Perfil Administrador
        const perfilRes = await pool.query("SELECT id FROM perfil WHERE strNombrePerfil = 'Administrador'");
        let adminPerfilId;
        
        if (perfilRes.rows.length === 0) {
            const insPerfil = await pool.query(
                "INSERT INTO perfil (strNombrePerfil, bitAdministrador) VALUES ('Administrador', TRUE) RETURNING id"
            );
            adminPerfilId = insPerfil.rows[0].id;
            console.log('✅ Perfil Administrador creado');
        } else {
            adminPerfilId = perfilRes.rows[0].id;
        }

        // Insertar Usuario Administrador inicial
        const userRes = await pool.query("SELECT id FROM usuario WHERE strNombreUsuario = 'admin'");
        if (userRes.rows.length === 0) {
            const hashedPwd = await bcrypt.hash('admin123', 10);
            await pool.query(
                `INSERT INTO usuario (strNombreUsuario, idPerfil, strPwd, strCorreo, idEstadoUsuario) 
                 VALUES ('admin', $1, $2, 'admin@correo.com', 'activo')`,
                [adminPerfilId, hashedPwd]
            );
            console.log('⭐ Administrador creado: usuario "admin" / clave "admin123"');
        }

    } catch (err) {
        console.error('❌ Error en initDB:', err);
    }
};
initDB();

// --- 4. Ruta de Login (JWT + hCaptcha) ---
app.post('/api/login', async (req, res) => {
    try {
        const { username, password, hCaptchaToken } = req.body;

        // Validar hCaptcha
        const verify = await fetch(`https://hcaptcha.com/siteverify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `response=${hCaptchaToken}&secret=${H_SECRET}`
        });
        const captchaData = await verify.json();
        if (!captchaData.success) return res.status(400).json({ message: 'Captcha inválido' });

        // Validar Usuario y Perfil
        const result = await pool.query(
            `SELECT u.*, p.strNombrePerfil 
             FROM usuario u 
             JOIN perfil p ON u.idPerfil = p.id 
             WHERE u.strNombreUsuario = $1`, [username]
        );

        if (result.rows.length === 0) return res.status(401).json({ message: 'Usuario no encontrado' });

        const user = result.rows[0];

        // Validar Estado Activo
        if (user.idestadousuario !== 'activo') {
            return res.status(403).json({ message: 'El usuario se encuentra inactivo' });
        }

        // Validar Contraseña
        const match = await bcrypt.compare(password, user.strpwd);
        if (!match) return res.status(401).json({ message: 'Contraseña incorrecta' });

        // Obtener Permisos para el frontend
        const permisos = await pool.query(
            `SELECT m.strNombreModulo, pp.* FROM permisos_perfil pp 
             JOIN modulo m ON pp.idModulo = m.id 
             WHERE pp.idPerfil = $1`, [user.idperfil]
        );

        const token = jwt.sign({ id: user.id, perfil: user.idperfil }, JWT_SECRET, { expiresIn: '8h' });

        res.json({
            success: true,
            token,
            user: { username: user.strnombreusuario, perfil: user.strnombreperfil, foto: user.urlimagen },
            permisos: permisos.rows
        });

    } catch (err) {
        res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
});

// --- 5. Hosting y Manejo de Rutas (Breadcrumbs) ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corporativo ejecutándose en puerto ${PORT}`);
});