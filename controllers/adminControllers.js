const db = require('../config/db');
const bcrypt = require('bcryptjs');

/**
 * GET /admin/dashboard
 * System Overview & Quick Admin Stats
 */
exports.getAdminDashboard = async (req, res, next) => {
    try {
        const [[{ totalUsers }]] = await db.execute('SELECT COUNT(*) AS totalUsers FROM users');
        const [[{ activeUsers }]] = await db.execute('SELECT COUNT(*) AS activeUsers FROM users WHERE is_active = 1');
        const [[{ totalLogins }]] = await db.execute('SELECT COUNT(*) AS totalLogins FROM audit_logs WHERE action = "USER_LOGIN"');

        const [recentLogs] = await db.execute(`
            SELECT a.*, u.badge_number, u.first_name, u.last_name 
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            ORDER BY a.created_at DESC LIMIT 10
        `);

        res.render('admin/dashboard', {
            title: 'Admin Dashboard | Limbe Police CMS',
            stats: { totalUsers, activeUsers, totalLogins },
            recentLogs
        });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /admin/users
 * User List & Search Filtering
 */
exports.getUsers = async (req, res, next) => {
    try {
        const search = req.query.search ? `%${req.query.search.trim()}%` : '%';
        const roleFilter = req.query.role || '';

        let query = `
            SELECT id, badge_number, rank_title, first_name, last_name, email, role, phone_number, is_active, created_at
            FROM users
            WHERE (badge_number LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)
        `;
        let params = [search, search, search, search];

        if (roleFilter) {
            query += ` AND role = ?`;
            params.push(roleFilter);
        }

        query += ` ORDER BY created_at DESC`;

        const [users] = await db.execute(query, params);

        res.render('admin/users/index', {
            title: 'User Management | Limbe Police CMS',
            users,
            searchQuery: req.query.search || '',
            roleFilter,
            success: req.flash ? req.flash('success') : null,
            error: req.flash ? req.flash('error') : null
        });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /admin/users/create
 * Form to Register New Personnel
 */
exports.getCreateUser = (req, res) => {
    res.render('admin/users/create', {
        title: 'Register Personnel | Limbe Police CMS',
        error: null,
        formData: {}
    });
};

/**
 * POST /admin/users/create
 * Insert New Officer into Database
 */
exports.postCreateUser = async (req, res, next) => {
    try {
        const { badge_number, rank_title, first_name, last_name, email, phone_number, role, password } = req.body;

        // basic validation
        if (!badge_number || !first_name || !last_name || !email || !role || !password) {
            return res.render('admin/users/create', {
                title: 'Register Personnel | Limbe Police CMS',
                error: 'Please complete all required fields.',
                formData: req.body
            });
        }

        // Check unique badge or email
        const [existing] = await db.execute(
            'SELECT id FROM users WHERE badge_number = ? OR email = ?',
            [badge_number.trim(), email.trim().toLowerCase()]
        );

        if (existing.length > 0) {
            return res.render('admin/users/create', {
                title: 'Register Personnel | Limbe Police CMS',
                error: 'An officer with this Badge Number or Email already exists.',
                formData: req.body
            });
        }

        // Hash default password
        const hashedPassword = await bcrypt.hash(password, 10);

        await db.execute(`
            INSERT INTO users (badge_number, rank_title, first_name, last_name, email, phone_number, role, password_hash, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        `, [
            badge_number.trim(),
            rank_title.trim(),
            first_name.trim(),
            last_name.trim(),
            email.trim().toLowerCase(),
            phone_number ? phone_number.trim() : null,
            role,
            hashedPassword
        ]);

        // Audit Log entry
        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.session.user.id, 'USER_CREATED', `Created user ${badge_number} (${role})`]
        );

        res.redirect('/admin/users');
    } catch (err) {
        next(err);
    }
};

/**
 * POST /admin/users/:id/toggle-status
 * Activate or Deactivate Officer Account
 */
exports.toggleUserStatus = async (req, res, next) => {
    try {
        const userId = req.params.id;

        // Prevent admin from deactivating themselves
        if (parseInt(userId) === parseInt(req.session.user.id)) {
            return res.redirect('/admin/users');
        }

        const [users] = await db.execute('SELECT is_active, badge_number FROM users WHERE id = ?', [userId]);
        if (users.length === 0) return res.redirect('/admin/users');

        const newStatus = users[0].is_active ? 0 : 1;
        await db.execute('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, userId]);

        // Audit Log entry
        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
            [req.session.user.id, 'STATUS_CHANGE', `Toggled user status for ${users[0].badge_number} to ${newStatus ? 'Active' : 'Inactive'}`]
        );

        res.redirect('/admin/users');
    } catch (err) {
        next(err);
    }
};

/**
 * GET /admin/audit-logs
 * View System Audit Trail
 */
exports.getAuditLogs = async (req, res, next) => {
    try {
        const [logs] = await db.execute(`
            SELECT a.*, u.badge_number, u.rank_title, u.first_name, u.last_name, u.role
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            ORDER BY a.created_at DESC
            LIMIT 100
        `);

        res.render('admin/audit-logs', {
            title: 'Audit Logs | Limbe Police CMS',
            logs
        });
    } catch (err) {
        next(err);
    }
};