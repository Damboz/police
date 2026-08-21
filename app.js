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
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const supervisorRoutes = require('./routes/supervisorRoutes');
const caseRoutes = require('./routes/caseRoutes');
const generalController = require('./controllers/generalController');

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
// Handled entirely by routes/authRoutes.js -> controllers/authController.js
// (login, logout, change-password, and role-based post-login redirection).
// The previous inline app.get/app.post handlers here were duplicating and
// overriding that controller logic, which is why role-based redirects were
// never firing. Removed in favor of the single source of truth below.
app.use('/auth', authRoutes);

// ----------------------------------------------------------------------------
// B. DASHBOARD ROUTE (role-aware redirect)
// ----------------------------------------------------------------------------
app.get('/dashboard', isAuthenticated, (req, res, next) => {
    const role = (req.session.user.role || '').toLowerCase();
    const roleId = req.session.user.role_id;

    if (role === 'admin' || roleId === 1) {
        return res.redirect('/admin/dashboard');
    }
    if (role === 'station commander' || role === 'supervisor' || roleId === 2) {
        return res.redirect('/supervisor/dashboard');
    }

    

    // Fallback for Investigating Officer / Counter-Intake Officer —
    // delegated to generalController for role-aware dashboard data
    // (assigned cases + KPIs for investigators, recent intakes for intake officers).
    return generalController.getDashboard(req, res, next);
});

// ----------------------------------------------------------------------------
// C. MOUNTED MODULAR ROUTERS
// ----------------------------------------------------------------------------
app.use('/admin', adminRoutes);
app.use('/supervisor', supervisorRoutes);
app.use('/cases', caseRoutes);

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