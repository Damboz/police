/**
 * ============================================================================
 * Limbe Police Station CMS - Authentication & Authorization Middleware
 * ============================================================================
 */

/**
 * Middleware to check if user is authenticated
 */
exports.isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    if (typeof req.flash === 'function') {
        req.flash('error', 'Please log in to access this page.');
    }
    return res.redirect('/auth/login');
};

/**
 * Middleware to restrict access strictly to System Administrators
 */
exports.isAdmin = (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === 'Admin') {
        return next();
    }
    return res.status(403).render('errors/403', {
        title: '403 Forbidden | Limbe Police CMS',
        message: 'Access Denied. System Administrator permissions required.'
    });
};

/**
 * Flexible middleware to restrict access based on allowed user roles
 * Example usage: authorizeRoles('SUPERVISOR', 'ADMIN') or authorizeRoles('Officer')
 */
exports.authorizeRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.session || !req.session.user) {
            if (typeof req.flash === 'function') {
                req.flash('error', 'Please log in to access this page.');
            }
            return res.redirect('/auth/login');
        }

        // Case-insensitive role comparison
        const userRole = req.session.user.role ? String(req.session.user.role).toUpperCase() : '';
        const normalizedAllowedRoles = allowedRoles.map(role => String(role).toUpperCase());

        if (normalizedAllowedRoles.includes(userRole)) {
            return next();
        }

        return res.status(403).render('errors/403', {
            title: '403 Forbidden | Limbe Police CMS',
            message: 'Access Denied. You do not have permission to view this resource.'
        });
    };
};