const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.db');

db.all("PRAGMA table_info(produto)", (err, cols) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log("PRODUTO COLUMNS:", cols.map(c => c.name));
    
    db.all("SELECT * FROM produto LIMIT 10", (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log("PRODUTO ROWS:", JSON.stringify(rows, null, 2));
        db.close();
    });
});
