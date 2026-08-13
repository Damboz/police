const db = require('../config/db');

/**
 * GET /supervisor/dashboard
 * Supervisor Operational Dashboard aligned with limbe_police_cms schema
 */
exports.getDashboard = async (req, res, next) => {
    try {
        // 1. KPI Counts (Combined into a single query for performance)
        const [[kpiCounts]] = await db.execute(`
            SELECT 
                SUM(CASE WHEN assigned_officer_id IS NULL AND status != 'Closed' THEN 1 ELSE 0 END) AS unassignedCount,
                SUM(CASE WHEN status = 'Court Pending' THEN 1 ELSE 0 END) AS pendingApprovalsCount,
                SUM(CASE WHEN status = 'Under Investigation' THEN 1 ELSE 0 END) AS activeCasesCount
            FROM cases
        `);

        // 2. Unassigned Cases (Requires Assignment)
        const [unassignedCases] = await db.execute(`
            SELECT 
                c.id, 
                c.ob_number AS case_number, 
                c.incident_details AS title, 
                cc.name AS crime_category, 
                c.priority, 
                c.created_at,
                CONCAT(u.first_name, ' ', u.last_name) AS registered_by_officer
            FROM cases c
            LEFT JOIN crime_categories cc ON c.category_id = cc.id
            LEFT JOIN users u ON c.intake_officer_id = u.id
            WHERE c.assigned_officer_id IS NULL AND c.status != 'Closed'
            ORDER BY FIELD(c.priority, 'Critical', 'High', 'Medium', 'Low'), c.created_at ASC
            LIMIT 10
        `);

        // 3. Pending Status Approvals / Court Review
        const [pendingApprovals] = await db.execute(`
            SELECT 
                c.id, 
                c.ob_number AS case_number, 
                c.incident_details AS title, 
                c.status, 
                c.priority, 
                c.updated_at,
                CONCAT(inv.rank_title, ' ', inv.last_name) AS investigator_name
            FROM cases c
            LEFT JOIN users inv ON c.assigned_officer_id = inv.id
            WHERE c.status = 'Court Pending'
            ORDER BY c.updated_at ASC
        `);

        // 4. Active Investigators Workload Summary
        const [investigatorWorkload] = await db.execute(`
            SELECT 
                u.id, 
                u.badge_number, 
                u.rank_title, 
                u.first_name, 
                u.last_name,
                COUNT(c.id) AS active_case_count
            FROM users u
            LEFT JOIN cases c ON u.id = c.assigned_officer_id AND c.status = 'Under Investigation'
            WHERE u.role IN ('Investigating Officer', 'investigator') AND u.is_active = 1
            GROUP BY u.id
            ORDER BY active_case_count ASC
        `);

        res.render('supervisor/dashboard', {
            title: 'Supervisor Command Dashboard | Limbe Police CMS',
            kpi: {
                unassigned: kpiCounts.unassignedCount || 0,
                pendingApprovals: kpiCounts.pendingApprovalsCount || 0,
                activeCases: kpiCounts.activeCasesCount || 0
            },
            unassignedCases,
            pendingApprovals,
            investigatorWorkload
        });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /supervisor/cases/assign
 * Assign or Reassign an Investigator to a Case
 */
exports.assignCase = async (req, res, next) => {
    try {
        const { case_id, investigator_id, notes } = req.body;
        const supervisorId = req.session?.user?.id;

        if (!case_id || !investigator_id) {
            req.flash('error', 'Please select both a valid case and an investigator.');
            return res.redirect('/supervisor/dashboard');
        }

        // Verify target user is an active investigator
        const [inv] = await db.execute(
            `SELECT id, badge_number, rank_title, last_name 
             FROM users 
             WHERE id = ? AND role IN ('Investigating Officer', 'investigator') AND is_active = 1`,
            [investigator_id]
        );

        if (inv.length === 0) {
            req.flash('error', 'Selected officer is not an active investigator.');
            return res.redirect('/supervisor/dashboard');
        }

        // Assign case and set status to 'Under Investigation'
        const [updateResult] = await db.execute(
            `UPDATE cases 
             SET assigned_officer_id = ?, status = 'Under Investigation', updated_at = NOW() 
             WHERE id = ?`,
            [investigator_id, case_id]
        );

        if (updateResult.affectedRows === 0) {
            req.flash('error', 'Case record not found or could not be updated.');
            return res.redirect('/supervisor/dashboard');
        }

        // Record entry in audit_logs
        await db.execute(
            `INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)`,
            [
                supervisorId,
                'CASE_ASSIGNED',
                `Assigned Case ID ${case_id} to Investigator ${inv[0].rank_title} ${inv[0].last_name} (${inv[0].badge_number}). ${notes ? 'Note: ' + notes : ''}`
            ]
        );

        req.flash('success', `Case assigned successfully to Officer ${inv[0].last_name}.`);
        res.redirect('/supervisor/dashboard');
    } catch (err) {
        next(err);
    }
};

/**
 * POST /supervisor/cases/approve-status
 * Approve or Reject a Status Change (Closure / Court Approval)
 */
exports.processStatusApproval = async (req, res, next) => {
    try {
        const { case_id, decision, supervisor_notes } = req.body; // decision: 'APPROVE' or 'REJECT'
        const supervisorId = req.session?.user?.id;

        if (!['APPROVE', 'REJECT'].includes(decision)) {
            req.flash('error', 'Invalid decision provided.');
            return res.redirect('/supervisor/dashboard');
        }

        const [caseRows] = await db.execute('SELECT id, ob_number, status FROM cases WHERE id = ?', [case_id]);
        if (caseRows.length === 0) {
            req.flash('error', 'Case record not found.');
            return res.redirect('/supervisor/dashboard');
        }

        const currentCase = caseRows[0];
        const targetStatus = decision === 'APPROVE' ? 'Closed' : 'Under Investigation';

        await db.execute(
            'UPDATE cases SET status = ?, updated_at = NOW() WHERE id = ?',
            [targetStatus, case_id]
        );

        await db.execute(
            'INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
            [
                supervisorId,
                `STATUS_APPROVAL_${decision}`,
                `Supervisor ${decision}D status change for Case OB ${currentCase.ob_number}. New status: ${targetStatus}. ${supervisor_notes ? 'Notes: ' + supervisor_notes : ''}`
            ]
        );

        req.flash('success', `Case OB ${currentCase.ob_number} status updated to ${targetStatus}.`);
        res.redirect('/supervisor/dashboard');
    } catch (err) {
        next(err);
    }
};

/**
 * GET /supervisor/analytics
 * Crime Trend Analytics & Hotspot Report
 */
exports.getAnalytics = async (req, res, next) => {
    try {
        const [
            [monthlyTrends],
            [categoryBreakdown],
            [hotspots],
            [statusDistribution]
        ] = await Promise.all([
            // 1. Monthly Trends (12 Months)
            db.execute(`
                SELECT 
                    DATE_FORMAT(created_at, '%Y-%m') AS month_key,
                    DATE_FORMAT(created_at, '%b %Y') AS month_label,
                    COUNT(*) AS total_cases,
                    SUM(CASE WHEN priority IN ('High', 'Critical') THEN 1 ELSE 0 END) AS severe_cases
                FROM cases
                WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
                GROUP BY month_key, month_label
                ORDER BY month_key ASC
            `),

            // 2. Crime Category Breakdown
            db.execute(`
                SELECT 
                    cc.name AS crime_category,
                    COUNT(c.id) AS total_incidents,
                    ROUND((COUNT(c.id) * 100.0 / NULLIF((SELECT COUNT(*) FROM cases), 0)), 1) AS percentage
                FROM crime_categories cc
                LEFT JOIN cases c ON cc.id = c.category_id
                GROUP BY cc.id, cc.name
                ORDER BY total_incidents DESC
            `),

            // 3. Hotspot Analysis (Top 10 Incident Locations)
            db.execute(`
                SELECT 
                    incident_location AS location,
                    COUNT(*) AS incident_count,
                    SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) AS resolved_count,
                    SUM(CASE WHEN status = 'Under Investigation' THEN 1 ELSE 0 END) AS active_count
                FROM cases
                WHERE incident_location IS NOT NULL AND TRIM(incident_location) != ''
                GROUP BY incident_location
                ORDER BY incident_count DESC
                LIMIT 10
            `),

            // 4. Status Distribution
            db.execute(`
                SELECT 
                    status,
                    COUNT(*) AS total_count
                FROM cases
                GROUP BY status
            `)
        ]);

        const totalCases = statusDistribution.reduce((acc, curr) => acc + curr.total_count, 0);
        const closedCases = statusDistribution.find(s => s.status === 'Closed')?.total_count || 0;
        const resolutionRate = totalCases > 0 ? Number(((closedCases / totalCases) * 100).toFixed(1)) : 0;

        res.render('supervisor/analytics', {
            title: 'Crime Trend Analytics & Hotspots | Limbe Police CMS',
            monthlyTrends,
            categoryBreakdown,
            hotspots,
            statusDistribution,
            metrics: {
                totalCases,
                closedCases,
                resolutionRate
            }
        });
    } catch (err) {
        next(err);
    }
};

/**
 * GET /supervisor/api/analytics-data
 */
exports.getAnalyticsData = async (req, res, next) => {
    try {
        const [[trends], [categories], [hotspots]] = await Promise.all([
            db.execute(`
                SELECT DATE_FORMAT(created_at, '%b %Y') AS label, COUNT(*) AS count 
                FROM cases 
                WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
                GROUP BY DATE_FORMAT(created_at, '%Y-%m'), label 
                ORDER BY DATE_FORMAT(created_at, '%Y-%m') ASC
            `),
            db.execute(`
                SELECT cc.name AS label, COUNT(c.id) AS count 
                FROM crime_categories cc
                LEFT JOIN cases c ON cc.id = c.category_id
                GROUP BY cc.id, cc.name
            `),
            db.execute(`
                SELECT incident_location AS label, COUNT(*) AS count 
                FROM cases 
                WHERE incident_location IS NOT NULL AND TRIM(incident_location) != ''
                GROUP BY incident_location 
                ORDER BY count DESC 
                LIMIT 5
            `)
        ]);

        res.json({
            success: true,
            data: { trends, categories, hotspots }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};