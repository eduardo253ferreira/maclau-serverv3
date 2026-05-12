const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, '..', 'database.db'));

db.run("UPDATE laser_tasks SET estado = 'pronto para corte' WHERE estado = 'em corte' AND data_hora_inicio IS NULL", function(err) {
    if (err) {
        console.error(err.message);
    } else {
        console.log(`Rows updated: ${this.changes}`);
    }
    db.close();
});
