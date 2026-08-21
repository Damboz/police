const db = require('../config/db');

const OVERDUE_DAYS_THRESHOLD = 14;

/**
 * GET /dashboard (fallback branch — Investigating Officer & Counter/Intake Officer)
 * Role-aware landing dashboard.
 */
exports.getDashboard = async (req, res, next) => {
    try {
        const user = req.session.user;
        const role = user.role;

        if (role === 'Investigating Officer') {
            const [[kpi]] = await db.execute(`
                SELECT 
                    COUNT(*) AS totalAssigned,
                    SUM(CASE WHEN status = 'Under Investigation' THEN 1 ELSE 0 END) AS activeCount,
                    SUM(CASE WHEN status = 'Under Investigation' AND DATEDIFF(CURDATE(), created_at) > ${OVERDUE_DAYS_THRESHOLD} THEN 1 ELSE 0 END) AS overdueCount,
                    SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) AS closedCount,
                    SUM(CASE WHEN requested_status IS NOT NULL THEN 1 ELSE 0 END) AS pendingRequestCount
                FROM cases
                WHERE assigned_officer_id = ?
            `, [user.id]);

            const [assignedCases] = await db.execute(`
                SELECT 
                    c.id, c.ob_number, c.incident_details AS title, cc.name AS crime_category,
                    c.priority, c.status, c.requested_status, c.created_at,
                    DATEDIFF(CURDATE(), c.created_at) AS days_open
                FROM cases c
                LEFT JOIN crime_categories cc ON c.category_id = cc.id
                WHERE c.assigned_officer_id = ?
                ORDER BY FIELD(c.priority, 'Critical', 'High', 'Medium', 'Low'), c.created_at ASC
            `, [user.id]);

            return res.render('general/dashboard', {
                title: 'My Cases | Limbe Police CMS',
                role,
                overdueDaysThreshold: OVERDUE_DAYS_THRESHOLD,
                kpi: {
                    totalAssigned: kpi.totalAssigned || 0,
                    active: kpi.activeCount || 0,
                    overdue: kpi.overdueCount || 0,
                    closed: kpi.closedCount || 0,
                    pendingRequest: kpi.pendingRequestCount || 0
                },
                assignedCases
            });
        }

        // Counter / Intake Officer fallback
        const [[intakeStats]] = await db.execute(`
            SELECT COUNT(*) AS totalIntake
            FROM cases
            WHERE intake_officer_id = ? AND DATE(created_at) = CURDATE()
        `, [user.id]);

        const [recentIntakes] = await db.execute(`
            SELECT id, ob_number, complainant_name, priority, status, created_at
            FROM cases
            WHERE intake_officer_id = ?
            ORDER BY created_at DESC
            LIMIT 10
        `, [user.id]);

        return res.render('general/dashboard', {
            title: 'Intake Desk | Limbe Police CMS',
            role,
            todayIntakeCount: intakeStats.totalIntake || 0,
            recentIntakes
        });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /cases/:id
 * Full case workspace — overview, notes/timeline, evidence, suspects, victims,
 * and status request state. Visible to all roles; action forms are gated by
 * the `permissions` object computed below.
 */
exports.getCaseDetail = async (req, res, next) => {
    try {
        const { id } = req.params;
        const user = req.session.user;

        const [rows] = await db.execute(`
            SELECT 
                c.*,
                cc.name AS crime_category,
                su.name AS unit_name,
                CONCAT(intake.rank_title, ' ', intake.first_name, ' ', intake.last_name) AS intake_officer_name,
                CONCAT(assigned.rank_title, ' ', assigned.first_name, ' ', assigned.last_name) AS assigned_officer_name,
                CONCAT(req_user.rank_title, ' ', req_user.first_name, ' ', req_user.last_name) AS status_requested_by_name
            FROM cases c
            LEFT JOIN crime_categories cc ON c.category_id = cc.id
            LEFT JOIN station_units su ON c.unit_id = su.id
            LEFT JOIN users intake ON c.intake_officer_id = intake.id
            LEFT JOIN users assigned ON c.assigned_officer_id = assigned.id
            LEFT JOIN users req_user ON c.status_requested_by = req_user.id
            WHERE c.id = ?
        `, [id]);

        if (rows.length === 0) {
            req.flash('error', 'Case record not found.');
            return res.redirect('/cases');
        }
        const caseItem = rows[0];

        const [notes] = await db.execute(`
            SELECT n.id, n.note, n.created_at, CONCAT(u.rank_title, ' ', u.first_name, ' ', u.last_name) AS officer_name
            FROM case_notes n
            LEFT JOIN users u ON n.officer_id = u.id
            WHERE n.case_id = ?
            ORDER BY n.created_at DESC
        `, [id]);

        const [evidenceItems] = await db.execute(`
            SELECT e.*, CONCAT(u.rank_title, ' ', u.first_name, ' ', u.last_name) AS collected_by_name
            FROM evidence e
            LEFT JOIN users u ON e.collected_by_officer_id = u.id
            WHERE e.case_id = ?
            ORDER BY e.collected_at DESC
        `, [id]);

        const [suspects] = await db.execute(`
            SELECT s.id, s.first_name, s.last_name, s.alias, s.national_id, s.photo_url, cs.status AS link_status, cs.arrest_date
            FROM case_suspects cs
            JOIN suspects s ON cs.suspect_id = s.id
            WHERE cs.case_id = ?
        `, [id]);

        const [victims] = await db.execute(`
            SELECT id, full_name, phone_number, email, national_id, statement
            FROM victims
            WHERE case_id = ?
        `, [id]);

        // Permission flags, computed once here so the view stays purely presentational
        const isAssignedInvestigator = user.role === 'Investigating Officer' && caseItem.assigned_officer_id === user.id;
        const isIntakeOfficer = user.role === 'Counter/Intake Officer';

        const permissions = {
            canAddNote: isAssignedInvestigator,
            canRequestStatus: isAssignedInvestigator && !caseItem.requested_status && caseItem.status === 'Under Investigation',
            canAddEvidence: isAssignedInvestigator,
            canLinkSuspectVictim: isAssignedInvestigator || isIntakeOfficer
        };

        res.render('cases/detail', {
            title: `Case ${caseItem.ob_number} | Limbe Police CMS`,
            caseItem,
            notes,
            evidenceItems,
            suspects,
            victims,
            permissions
        });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /cases/:id/notes
 * Investigation Notes & Timeline — assigned investigator only.
 */
exports.addCaseNote = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { note } = req.body;
        const user = req.session.user;

        if (!note || !note.trim()) {
            req.flash('error', 'Note cannot be empty.');
            return res.redirect(`/cases/${id}`);
        }

        const [caseRows] = await db.execute('SELECT assigned_officer_id FROM cases WHERE id = ?', [id]);
        if (caseRows.length === 0) {
            req.flash('error', 'Case not found.');
            return res.redirect('/cases');
        }
        if (user.role !== 'Investigating Officer' || caseRows[0].assigned_officer_id !== user.id) {
            req.flash('error', 'Only the assigned investigator can add notes to this case.');
            return res.redirect(`/cases/${id}`);
        }

        await db.execute(
            'INSERT INTO case_notes (case_id, officer_id, note) VALUES (?, ?, ?)',
            [id, user.id, note.trim()]
        );

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
            [user.id, 'CASE_NOTE_ADDED', `Added investigation note to Case ID ${id}.`]
        );

        req.flash('success', 'Investigation note added.');
        res.redirect(`/cases/${id}`);
    } catch (err) {
        next(err);
    }
};

/**
 * POST /cases/:id/request-status
 * Status Request — assigned investigator requests Closed or Court Pending,
 * for Supervisor sign-off. Case remains 'Under Investigation' until approved.
 */
exports.requestStatusChange = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { requested_status, status_request_notes } = req.body;
        const user = req.session.user;

        if (!['Closed', 'Court Pending'].includes(requested_status)) {
            req.flash('error', 'Invalid status request.');
            return res.redirect(`/cases/${id}`);
        }

        const [caseRows] = await db.execute(
            'SELECT assigned_officer_id, status, requested_status FROM cases WHERE id = ?',
            [id]
        );
        if (caseRows.length === 0) {
            req.flash('error', 'Case not found.');
            return res.redirect('/cases');
        }
        const current = caseRows[0];

        if (user.role !== 'Investigating Officer' || current.assigned_officer_id !== user.id) {
            req.flash('error', 'Only the assigned investigator can request a status change.');
            return res.redirect(`/cases/${id}`);
        }
        if (current.requested_status) {
            req.flash('error', 'A status change request is already pending supervisor review.');
            return res.redirect(`/cases/${id}`);
        }

        await db.execute(
            `UPDATE cases 
             SET requested_status = ?, status_request_notes = ?, status_requested_by = ?, status_requested_at = NOW() 
             WHERE id = ?`,
            [requested_status, status_request_notes || null, user.id, id]
        );

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
            [user.id, 'STATUS_CHANGE_REQUESTED', `Requested status change to "${requested_status}" for Case ID ${id}.`]
        );

        req.flash('success', 'Status change request submitted for supervisor review.');
        res.redirect(`/cases/${id}`);
    } catch (err) {
        next(err);
    }
};

/**
 * POST /cases/:id/evidence
 * Evidence Logging & Chain of Custody — assigned investigator only.
 * Note: the `evidence` table has no file/photo column in the current schema,
 * so this logs structured item records (item number, description, category,
 * storage location) rather than an actual file upload. Adding real photo/file
 * uploads would need a new column plus multer file-handling middleware —
 * flagging this as a follow-up rather than assuming it.
 */
exports.addEvidence = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { item_number, description, category, storage_location, collected_at } = req.body;
        const user = req.session.user;

        const [caseRows] = await db.execute('SELECT assigned_officer_id FROM cases WHERE id = ?', [id]);
        if (caseRows.length === 0) {
            req.flash('error', 'Case not found.');
            return res.redirect('/cases');
        }
        if (user.role !== 'Investigating Officer' || caseRows[0].assigned_officer_id !== user.id) {
            req.flash('error', 'Only the assigned investigator can log evidence for this case.');
            return res.redirect(`/cases/${id}`);
        }

        if (!item_number || !description || !storage_location || !collected_at) {
            req.flash('error', 'Please complete all required evidence fields.');
            return res.redirect(`/cases/${id}`);
        }

        await db.execute(
            `INSERT INTO evidence (case_id, item_number, description, category, storage_location, collected_by_officer_id, collected_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'In Locker')`,
            [id, item_number, description, category || 'Physical', storage_location, user.id, collected_at]
        );

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
            [user.id, 'EVIDENCE_LOGGED', `Logged evidence item "${item_number}" for Case ID ${id}.`]
        );

        req.flash('success', 'Evidence item logged successfully.');
        res.redirect(`/cases/${id}`);
    } catch (err) {
        next(err);
    }
};

/**
 * POST /cases/:id/suspects
 * Creates a suspect record and links it to the case.
 * Allowed for: the assigned investigator, and Counter/Intake Officer
 * (per RBAC matrix: Investigator "Assigned Only", Police Officer "Initial Entry").
 */
exports.linkSuspect = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { first_name, last_name, alias, national_id, gender, phone_number, photo_url, notes } = req.body;
        const user = req.session.user;

        if (!first_name || !last_name || !gender) {
            req.flash('error', 'Suspect first name, last name, and gender are required.');
            return res.redirect(`/cases/${id}`);
        }

        const [caseRows] = await db.execute('SELECT assigned_officer_id FROM cases WHERE id = ?', [id]);
        if (caseRows.length === 0) {
            req.flash('error', 'Case not found.');
            return res.redirect('/cases');
        }

        const allowed = (user.role === 'Investigating Officer' && caseRows[0].assigned_officer_id === user.id)
            || user.role === 'Counter/Intake Officer';
        if (!allowed) {
            req.flash('error', 'You do not have permission to link suspects to this case.');
            return res.redirect(`/cases/${id}`);
        }

        const [suspectResult] = await db.execute(
            `INSERT INTO suspects (first_name, last_name, alias, national_id, gender, phone_number, photo_url, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [first_name, last_name, alias || null, national_id || null, gender, phone_number || null, photo_url || null, notes || null]
        );

        await db.execute(
            `INSERT INTO case_suspects (case_id, suspect_id, status) VALUES (?, ?, 'Under Investigation')`,
            [id, suspectResult.insertId]
        );

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
            [user.id, 'SUSPECT_LINKED', `Linked suspect "${first_name} ${last_name}" to Case ID ${id}.`]
        );

        req.flash('success', 'Suspect linked to case successfully.');
        res.redirect(`/cases/${id}`);
    } catch (err) {
        next(err);
    }
};

/**
 * POST /cases/:id/victims
 * Allowed for: the assigned investigator, and Counter/Intake Officer (initial entry).
 */
exports.linkVictim = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { full_name, phone_number, email, national_id, address, statement } = req.body;
        const user = req.session.user;

        if (!full_name) {
            req.flash('error', 'Victim full name is required.');
            return res.redirect(`/cases/${id}`);
        }

        const [caseRows] = await db.execute('SELECT assigned_officer_id FROM cases WHERE id = ?', [id]);
        if (caseRows.length === 0) {
            req.flash('error', 'Case not found.');
            return res.redirect('/cases');
        }

        const allowed = (user.role === 'Investigating Officer' && caseRows[0].assigned_officer_id === user.id)
            || user.role === 'Counter/Intake Officer';
        if (!allowed) {
            req.flash('error', 'You do not have permission to link victims to this case.');
            return res.redirect(`/cases/${id}`);
        }

        await db.execute(
            `INSERT INTO victims (case_id, full_name, phone_number, email, national_id, address, statement)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, full_name, phone_number || null, email || null, national_id || null, address || null, statement || null]
        );

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
            [user.id, 'VICTIM_LINKED', `Linked victim "${full_name}" to Case ID ${id}.`]
        );

        req.flash('success', 'Victim information added to case.');
        res.redirect(`/cases/${id}`);
    } catch (err) {
        next(err);
    }
};