const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.db');

const tables = ['clientes', 'avarias', 'servicos', 'manutencoes'];

tables.forEach(table => {
    db.all(`PRAGMA table_info(${table})`, (err, rows) => {
        if (err) {
            console.error(`Error checking ${table}:`, err);
            return;
        }
        if (rows && rows.length > 0) {
            console.log(`${table.toUpperCase()} Columns:`, rows.map(r => r.name).join(', '));
        } else {
            console.log(`${table.toUpperCase()} does not exist or has no columns.`);
        }
    });
});

setTimeout(() => db.close(), 2000);
