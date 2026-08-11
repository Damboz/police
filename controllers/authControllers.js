const db = require('../config/db');
const bcrypt = require('bcryptjs');

/**
 * GET /auth/login
 * Render Login Page
 */
exports.getLogin = (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
    }
    
    const flashError = req.flash ? req.flash('error') : null;
    const flashSuccess = req.flash ? req.flash('success') : null;

    res.render('auth/login', {
        title: 'Login | Limbe Police CMS',
        error: (flashError && flashError.length > 0) ? flashError[0] : null,
        success: (flashSuccess && flashSuccess.length > 0) ? flashSuccess[0] : null
    });
};

/**
 * POST /auth/login
 * Authenticate Personnel & Create Session
 */
exports.postLogin = async (req, res, next) => {
    try {
        const { badge_number, password } = req.body;

        if (!badge_number || !password) {
            return res.status(400).render('auth/login', {
                title: 'Login | Limbe Police CMS',
                error: 'Please provide both Badge Number / Username and Password.',
                success: null
            });
        }

        const identifier = badge_number.trim();

        const [users] = await db.execute(`
            SELECT id, badge_number, rank_title, first_name, last_name, email, password_hash, role, is_active 
            FROM users 
            WHERE badge_number = ? OR email = ?
        `, [identifier, identifier.toLowerCase()]);

        if (users.length === 0) {
            return res.status(401).render('auth/login', {
                title: 'Login | Limbe Police CMS',
                error: 'Invalid credentials. Please verify your badge number or email.',
                success: null
            });
        }

        const user = users[0];

        if (!user.is_active) {
            return res.status(403).render('auth/login', {
                title: 'Login | Limbe Police CMS',
                error: 'Account deactivated. Please contact your System Administrator.',
                success: null
            });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).render('auth/login', {
                title: 'Login | Limbe Police CMS',
                error: 'Invalid credentials. Please check your password.',
                success: null
            });
        }

        req.session.user = {
            id: user.id,
            badge_number: user.badge_number,
            rank_title: user.rank_title,
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
            role: user.role
        };

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
            [user.id, 'USER_LOGIN', `Officer ${user.badge_number} logged in successfully.`]
        );

        res.redirect('/dashboard');
    } catch (err) {
        next(err);
    }
};

/**
 * GET /auth/logout
 * Destroy Session & Redirect to Login
 */
exports.logout = async (req, res) => {
    if (req.session && req.session.user) {
        const userId = req.session.user.id;
        const badgeNumber = req.session.user.badge_number;

        try {
            await db.execute(
                'INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
                [userId, 'USER_LOGOUT', `Officer ${badgeNumber} logged out.`]
            );
        } catch (err) {
            console.error('Failed to log audit entry for logout:', err);
        }

        req.session.destroy((err) => {
            if (err) console.error('Logout Session Error:', err);
            res.redirect('/auth/login');
        });
    } else {
        res.redirect('/auth/login');
    }
};

/**
 * GET /auth/change-password
 * Render Change Password View (Accessible to ALL logged-in users)
 */
exports.getChangePassword = (req, res) => {
    if (!req.session || !req.session.user) {
        return res.redirect('/auth/login');
    }

    const flashError = req.flash ? req.flash('error') : null;
    const flashSuccess = req.flash ? req.flash('success') : null;

    res.render('auth/change-password', {
        title: 'Change Password | Limbe Police CMS',
        error: (flashError && flashError.length > 0) ? flashError[0] : null,
        success: (flashSuccess && flashSuccess.length > 0) ? flashSuccess[0] : null
    });
};

/**
 * POST /auth/change-password
 * Validate & Update Password (Accessible to ALL logged-in users)
 */
exports.postChangePassword = async (req, res, next) => {
    try {
        if (!req.session || !req.session.user) {
            return res.redirect('/auth/login');
        }

        const { current_password, new_password, confirm_password } = req.body;
        const userId = req.session.user.id;

        // Validation: Required fields
        if (!current_password || !new_password || !confirm_password) {
            return res.render('auth/change-password', {
                title: 'Change Password | Limbe Police CMS',
                error: 'All password fields are required.',
                success: null
            });
        }

        // Validation: Password matching
        if (new_password !== confirm_password) {
            return res.render('auth/change-password', {
                title: 'Change Password | Limbe Police CMS',
                error: 'New password and confirmation password do not match.',
                success: null
            });
        }

        // Validation: Minimum length
        if (new_password.length < 6) {
            return res.render('auth/change-password', {
                title: 'Change Password | Limbe Police CMS',
                error: 'New password must be at least 6 characters long.',
                success: null
            });
        }

        // Fetch user record
        const [users] = await db.execute('SELECT password_hash, badge_number FROM users WHERE id = ?', [userId]);
        if (users.length === 0) {
            return res.redirect('/auth/login');
        }

        const user = users[0];

        // Verify existing password
        const isMatch = await bcrypt.compare(current_password, user.password_hash);
        if (!isMatch) {
            return res.render('auth/change-password', {
                title: 'Change Password | Limbe Police CMS',
                error: 'Incorrect current password.',
                success: null
            });
        }

        // Hash and update to new password
        const hashedNewPassword = await bcrypt.hash(new_password, 10);
        await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hashedNewPassword, userId]);

        // Write entry to Audit Logs
        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
            [userId, 'PASSWORD_CHANGED', `Officer ${user.badge_number} updated their password.`]
        );

        res.render('auth/change-password', {
            title: 'Change Password | Limbe Police CMS',
            error: null,
            success: 'Password updated successfully!'
        });

    } catch (err) {
        next(err);
    }
};