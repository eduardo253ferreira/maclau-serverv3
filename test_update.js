const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'database.db'));

db.run("UPDATE avarias SET numero_fatura = 'TESTE123' WHERE id = 6", [], function(err) {
    if (err) console.error(err);
    console.log("Linhas afetadas:", this.changes);
    db.get("SELECT numero_fatura FROM avarias WHERE id = 6", (err, row) => {
        console.log("Resultado:", row);
        db.close();
    });
});
