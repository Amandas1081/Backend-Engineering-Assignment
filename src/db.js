const mysql = require('mysql2/promise');
const config = require('./config');

function createPool(options = {}) {
  return mysql.createPool({ ...config.db, ...options, waitForConnections: true, namedPlaceholders: true });
}

module.exports = { createPool };
