const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'database.db'));
db.all("PRAGMA table_info(avarias)", [], (err, rows) => {
    console.log("AVARIAS:", rows.map(r => r.name));
    db.close();
});
