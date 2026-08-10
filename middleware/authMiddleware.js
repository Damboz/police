/**
 * Middleware to check if user is authenticated
 */
exports.isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    req.flash?.('error', 'Please log in to access this page.');
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