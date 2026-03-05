import express from 'express';
import cors from 'cors';
import pkg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const { Pool } = pkg;
const app = express();

// Middlewares
app.use(cors({
  origin: [
    'https://proyecto-login-production.up.railway.app',
    'https://czalbert6.github.io',
    'http://localhost:4321'
  ]
}));
app.use(express.json());

// Conexión a PostgreSQL - USANDO VARIABLE DE ENTORNO DE RAILWAY
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'mi_secreto_super_seguro_2024';

// Health check para Railway - ENDPOINT CORRECTO
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Crear tabla usuarios
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE,
        username VARCHAR(100) UNIQUE,
        nombre VARCHAR(100),
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabla usuarios lista');
  } catch (error) {
    console.error('❌ Error creando tabla:', error);
  }
}
initDB();

// REGISTRO
app.post('/api/register', async (req, res) => {
  try {
    const { email, username, nombre, password } = req.body;

    // Validaciones
    if (!email && !username) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email o nombre de usuario requerido' 
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'La contraseña debe tener al menos 6 caracteres' 
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let result;
    if (email) {
      result = await pool.query(
        `INSERT INTO usuarios (email, username, nombre, password) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id, email, username, nombre`,
        [email.toLowerCase(), username || null, nombre || null, hashedPassword]
      );
    } else {
      result = await pool.query(
        `INSERT INTO usuarios (username, nombre, password) 
         VALUES ($1, $2, $3) 
         RETURNING id, username, nombre`,
        [username, nombre || null, hashedPassword]
      );
    }

    const token = jwt.sign(
      { 
        id: result.rows[0].id, 
        email: result.rows[0].email, 
        username: result.rows[0].username 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      success: true,
      message: 'Registro exitoso',
      token,
      user: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Error en registro:', error);
    
    // Código 23505 = unique violation (email o username duplicado)
    if (error.code === '23505') {
      return res.status(400).json({ 
        success: false, 
        message: 'El email o nombre de usuario ya existe' 
      });
    }
    
    return res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor' 
    });
  }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const identifier = email || username;

    if (!identifier || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email/usuario y contraseña son requeridos' 
      });
    }

    let result;
    if (email) {
      result = await pool.query(
        'SELECT * FROM usuarios WHERE email = $1',
        [email.toLowerCase()]
      );
    } else {
      result = await pool.query(
        'SELECT * FROM usuarios WHERE username = $1',
        [username]
      );
    }

    if (result.rows.length === 0) {
      return res.status(401).json({ 
        success: false, 
        message: 'Credenciales inválidas' 
      });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ 
        success: false, 
        message: 'Credenciales inválidas' 
      });
    }

    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        username: user.username 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      message: 'Login exitoso',
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        nombre: user.nombre
      }
    });

  } catch (error) {
    console.error('❌ Error en login:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor' 
    });
  }
});

// Puerto para Railway (SIEMPRE usar process.env.PORT)
const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================`);
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📡 Health check: /health`);
  console.log(`📡 API: /api/register y /api/login`);
  console.log(`=================================`);
});