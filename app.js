/**
 * ============================================================================
 * Limbe Police Station Case Management System (CMS) - Web Application
 * File: app.js
 * Engine: Node.js / Express / EJS / MySQL2
 * ============================================================================
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const session = require('express-session');
const bcrypt = require('bcryptjs');

// Load environment variables from .env
dotenv.config();

// Load Database Connection Pool
let dbPool;
try {
  dbPool = require('./config/db');
} catch (e) {
  const mysql = require('mysql2/promise');
  dbPool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'limbe_police_cms',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
}

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// 1. VIEW ENGINE & MIDDLEWARE SETUP
// ============================================================================

// Set EJS as template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files from /public folder
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express Session Configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'limbe_police_cms_secure_session_key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 1000 * 60 * 60 * 8, // 8 Hours Session Lifetime
        httpOnly: true
    }
}));

// Pass local variables globally to all EJS templates
app.use((req, res, next) => {
    res.locals.session = req.session;
    res.locals.currentUser = req.session ? req.session.user : null;
    res.locals.error = null;
    res.locals.success = null;
    next();
});

// Route Guard: Ensures user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/auth/login');
};

// Route Guard: Restricts route to Admin users
const isAdmin = (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === 'Admin') {
        return next();
    }
    res.status(403).send('<h2>403 Forbidden</h2><p>Administrative privileges required.</p><a href="/dashboard">Return to Dashboard</a>');
};


// ============================================================================
// 2. WEB APPLICATION ROUTES
// ============================================================================

// Root Route
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
    }
    res.redirect('/auth/login');
});

// ----------------------------------------------------------------------------
// A. AUTHENTICATION ROUTES
// ----------------------------------------------------------------------------

// GET /auth/login - Render Login View
app.get('/auth/login', (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('auth/login', {
        title: 'Login | Limbe Police Station CMS',
        error: null,
        success: null
    });
});

// POST /auth/login - Process User Sign-In
app.post('/auth/login', async (req, res) => {
    const { badge_number, password } = req.body;

    if (!badge_number || !password) {
        return res.render('auth/login', {
            title: 'Login | Limbe Police Station CMS',
            error: 'Please enter both Badge/Email and Password.',
            success: null
        });
    }

    try {
        const identifier = badge_number.trim();
        const [users] = await dbPool.execute(
            'SELECT * FROM users WHERE badge_number = ? OR email = ?',
            [identifier, identifier.toLowerCase()]
        );

        if (users.length === 0) {
            return res.render('auth/login', {
                title: 'Login | Limbe Police Station CMS',
                error: 'Invalid credentials provided.',
                success: null
            });
        }

        const user = users[0];

        if (!user.is_active) {
            return res.render('auth/login', {
                title: 'Login | Limbe Police Station CMS',
                error: 'Account deactivated. Please contact administrator.',
                success: null
            });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.render('auth/login', {
                title: 'Login | Limbe Police Station CMS',
                error: 'Invalid credentials provided.',
                success: null
            });
        }

        // Set session user object
        req.session.user = {
            id: user.id,
            badge_number: user.badge_number,
            rank_title: user.rank_title,
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
            role: user.role
        };

        // Write entry to audit log
        await dbPool.execute(
            'INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
            [user.id, 'USER_LOGIN', `Officer ${user.badge_number} logged into web portal.`]
        );

        res.redirect('/dashboard');

    } catch (err) {
        console.error('Login Error:', err);
        res.render('auth/login', {
            title: 'Login | Limbe Police Station CMS',
            error: 'Database error encountered during sign-in.',
            success: null
        });
    }
});

// GET /auth/logout - Destroy Session
app.get('/auth/logout', async (req, res) => {
    if (req.session && req.session.user) {
        const userId = req.session.user.id;
        const badge = req.session.user.badge_number;

        try {
            await dbPool.execute(
                'INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
                [userId, 'USER_LOGOUT', `Officer ${badge} logged out.`]
            );
        } catch (e) {
            console.error('Logout audit logging failed:', e);
        }

        req.session.destroy(() => {
            res.redirect('/auth/login');
        });
    } else {
        res.redirect('/auth/login');
    }
});


// ----------------------------------------------------------------------------
// B. DASHBOARD & ADMINISTRATIVE VIEWS
// ----------------------------------------------------------------------------

// GET /dashboard - Main Station Dashboard
app.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
        const [[{ totalCases }]] = await dbPool.execute('SELECT COUNT(*) AS totalCases FROM cases');
        const [[{ openCases }]] = await dbPool.execute("SELECT COUNT(*) AS openCases FROM cases WHERE status != 'Closed'");
        const [[{ totalEvidence }]] = await dbPool.execute('SELECT COUNT(*) AS totalEvidence FROM evidence');
        const [[{ activeUsers }]] = await dbPool.execute('SELECT COUNT(*) AS activeUsers FROM users WHERE is_active = 1');

        // Fetch recent cases list
        const [recentCases] = await dbPool.execute('SELECT * FROM cases ORDER BY created_at DESC LIMIT 5');

        // Fetch recent audit logs required by dashboard.ejs
        const [recentLogs] = await dbPool.execute(`
            SELECT a.*, u.badge_number, u.rank_title, u.first_name, u.last_name 
            FROM audit_logs a 
            LEFT JOIN users u ON a.user_id = u.id 
            ORDER BY a.created_at DESC LIMIT 5
        `);

        res.render('admin/dashboard', {
            title: 'Station Dashboard | Limbe Police CMS',
            stats: { totalCases, openCases, totalEvidence, activeUsers },
            recentCases,
            recentLogs
        });
    } catch (err) {
        console.error('Dashboard Error:', err);
        res.status(500).send(`<h2>Server Error</h2><p>${err.message}</p>`);
    }
});

// GET /admin/audit-logs - Security Audit Trail View
app.get('/admin/audit-logs', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const [logs] = await dbPool.execute(`
            SELECT a.*, u.badge_number, u.rank_title, u.first_name, u.last_name, u.role
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            ORDER BY a.created_at DESC LIMIT 100
        `);

        res.render('admin/audit-logs', {
            title: 'Security Audit Logs | Limbe Police CMS',
            logs
        });
    } catch (err) {
        console.error('Audit Logs Error:', err);
        res.status(500).send('Error Loading Audit Trail');
    }
});


// ----------------------------------------------------------------------------
// C. REST API BACKEND ENDPOINTS
// ----------------------------------------------------------------------------

app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'UP', system: 'Limbe Police Station CMS' });
});


// ============================================================================
// 3. ERROR HANDLERS
// ============================================================================

// 404 Route Handler
app.use((req, res) => {
    res.status(404).send(`
        <div style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h2>404 - Resource Not Found</h2>
            <p>The requested path <code>${req.originalUrl}</code> does not exist on this server.</p>
            <a href="/dashboard" style="color: #004085; text-decoration: none; font-weight: bold;">Return to Dashboard</a>
        </div>
    `);
});

// Global Exception Handler
app.use((err, req, res, next) => {
    console.error('Unhandled System Error:', err);
    res.status(500).send('An unexpected system error occurred.');
});


// ============================================================================
// 4. SERVER LAUNCH
// ============================================================================

app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 Limbe Police Station Web Portal Live: http://localhost:${PORT}`);
    console.log(`=======================================================`);
});

module.exports = app;