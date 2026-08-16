const db = require('../config/db');

/**
 * Generates a unique Occurrence Book (OB) number for a new case.
 * Format: OB-YYYYMMDD-NNNN (sequential per calendar day)
 */
async function generateObNumber() {
    const today = new Date();
    const datePart = today.toISOString().slice(0, 10).replace(/-/g, '');

    const [[{ todayCount }]] = await db.execute(
        `SELECT COUNT(*) AS todayCount FROM cases WHERE DATE(created_at) = CURDATE()`
    );

    const sequence = String(todayCount + 1).padStart(4, '0');
    return `OB-${datePart}-${sequence}`;
}

/**
 * GET /cases
 * Case Register — list of all recorded cases.
 * Accessible to all authenticated roles per the RBAC matrix (everyone can view/register cases).
 */
exports.getCaseList = async (req, res, next) => {
    try {
        const [cases] = await db.execute(`
            SELECT 
                c.id, c.ob_number, c.complainant_name, c.priority, c.status, c.created_at,
                cc.name AS crime_category,
                su.name AS unit_name,
                CONCAT(intake.rank_title, ' ', intake.first_name, ' ', intake.last_name) AS intake_officer_name,
                assigned.id AS assigned_officer_id,
                CONCAT(assigned.rank_title, ' ', assigned.first_name, ' ', assigned.last_name) AS assigned_officer_name
            FROM cases c
            LEFT JOIN crime_categories cc ON c.category_id = cc.id
            LEFT JOIN station_units su ON c.unit_id = su.id
            LEFT JOIN users intake ON c.intake_officer_id = intake.id
            LEFT JOIN users assigned ON c.assigned_officer_id = assigned.id
            ORDER BY c.created_at DESC
        `);

        res.render('cases/index', {
            title: 'Case Register | Limbe Police CMS',
            cases
        });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /cases/new
 * Render the New Case Registration form
 */
exports.getNewCaseForm = async (req, res, next) => {
    try {
        const [categories] = await db.execute('SELECT id, name, severity_level FROM crime_categories ORDER BY name ASC');
        const [units] = await db.execute('SELECT id, code, name FROM station_units ORDER BY name ASC');

        res.render('cases/register', {
            title: 'Register New Case | Limbe Police CMS',
            categories,
            units
        });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /cases
 * Create a new case (Occurrence Book entry).
 * Available to all authenticated roles — Admin, Station Commander, Investigating Officer,
 * and Counter/Intake Officer can all register a case per the RBAC matrix.
 */
exports.createCase = async (req, res, next) => {
    try {
        const {
            complainant_name,
            complainant_id_number,
            complainant_phone,
            complainant_address,
            complainant_gender,
            category_id,
            unit_id,
            priority,
            incident_datetime,
            incident_location,
            incident_details
        } = req.body;

        const intakeOfficerId = req.session?.user?.id;

        // Required-field validation — mirrors the NOT NULL constraints on the `cases` table
        if (!complainant_name || !complainant_phone || !category_id || !unit_id || !incident_location || !incident_details) {
            req.flash('error', 'Please complete all required fields before submitting.');
            return res.redirect('/cases/new');
        }

        const obNumber = await generateObNumber();

        await db.execute(
            `INSERT INTO cases (
                ob_number, complainant_name, complainant_id_number, complainant_phone,
                complainant_address, complainant_gender, category_id, unit_id, priority,
                incident_datetime, incident_location, incident_details, intake_officer_id, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Reported')`,
            [
                obNumber,
                complainant_name,
                complainant_id_number || null,
                complainant_phone,
                complainant_address || null,
                complainant_gender || 'Other',
                category_id,
                unit_id,
                priority || 'Medium',
                incident_datetime || null,
                incident_location,
                incident_details,
                intakeOfficerId
            ]
        );

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
            [intakeOfficerId, 'CASE_REGISTERED', `Registered new Case OB ${obNumber} for complainant ${complainant_name}.`]
        );

        req.flash('success', `Case registered successfully with reference ${obNumber}.`);
        res.redirect('/cases');
    } catch (err) {
        next(err);
    }
};