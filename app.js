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
const flash = require('connect-flash');
const bcrypt = require('bcryptjs');

// Load environment variables
dotenv.config();

// Initialize Express Application
const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// 1. DATABASE CONNECTION POOL SETUP
// ============================================================================
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

// ============================================================================
// 2. ROUTE IMPORTS
// ============================================================================
const adminRoutes = require('./routes/adminRoutes');
const supervisorRoutes = require('./routes/supervisorRoutes');

// ============================================================================
// 3. VIEW ENGINE & MIDDLEWARE SETUP
// ============================================================================

// Set EJS as view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Core Middlewares
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

// Flash Messages
app.use(flash());

// Pass Global Variables to Views
app.use((req, res, next) => {
    res.locals.session = req.session;
    res.locals.currentUser = req.session ? req.session.user : null;
    res.locals.error = req.flash('error');
    res.locals.success = req.flash('success');
    next();
});

// Route Guard Middleware
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/auth/login');
};

// ============================================================================
// 4. WEB APPLICATION ROUTES
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
        error: req.flash('error').length > 0 ? req.flash('error') : null,
        success: req.flash('success').length > 0 ? req.flash('success') : null
    });
});

// POST /auth/login - Process Sign-In
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
// B. DASHBOARD ROUTE
// ----------------------------------------------------------------------------

app.get('/dashboard', isAuthenticated, async (req, res) => {
    try {
        const [[{ totalCases }]] = await dbPool.execute('SELECT COUNT(*) AS totalCases FROM cases');
        const [[{ openCases }]] = await dbPool.execute("SELECT COUNT(*) AS openCases FROM cases WHERE status != 'Closed'");
        const [[{ totalEvidence }]] = await dbPool.execute('SELECT COUNT(*) AS totalEvidence FROM evidence');
        const [[{ activeUsers }]] = await dbPool.execute('SELECT COUNT(*) AS activeUsers FROM users WHERE is_active = 1');

        const [recentCases] = await dbPool.execute('SELECT * FROM cases ORDER BY created_at DESC LIMIT 5');

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

// ----------------------------------------------------------------------------
// C. MOUNTED MODULAR ROUTERS
// ----------------------------------------------------------------------------
app.use('/admin', adminRoutes);
app.use('/supervisor', supervisorRoutes);

// ----------------------------------------------------------------------------
// D. REST API ENDPOINTS
// ----------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'UP', system: 'Limbe Police Station CMS' });
});

// ============================================================================
// 5. ERROR HANDLERS & SERVER STARTUP
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

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled System Error:', err);
    res.status(500).send('An unexpected system error occurred.');
});

// Start Server
app.listen(PORT, () => {
    console.log(`Limbe Police Station Web Portal Live: http://localhost:${PORT}`);
});

module.exports = app;