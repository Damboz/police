const mysql = require('mysql2/promise');
require('dotenv').config();

// Create MySQL Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '210000gb',
    database: process.env.DB_NAME || 'limbe_police_cms',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

// Test Database Connectivity on Application Startup
pool.getConnection()
    .then((connection) => {
        console.log('✅ MySQL Database Connected Successfully [Database: limbe_police_cms]');
        connection.release();
    })
    .catch((err) => {
        console.error('❌ Database Connection Error:', err.message);
    });

module.exports = pool;