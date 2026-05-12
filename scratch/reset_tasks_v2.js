const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, '..', 'database.db'));

// Reset tasks that are in 'em corte' but have no start time (NaN prevention)
// and set a default original name for existing tasks
db.serialize(() => {
    db.run("UPDATE laser_tasks SET estado = 'pronto para corte', data_hora_inicio = NULL WHERE estado = 'em corte' AND data_hora_inicio IS NULL", function(err) {
        console.log(`Reset stuck tasks: ${this.changes}`);
    });

    db.run("UPDATE laser_tasks SET desenho_nome_original = 'desenho_maclau' WHERE desenho_nome_original IS NULL AND desenho_caminho IS NOT NULL", function(err) {
        console.log(`Updated filenames for existing tasks: ${this.changes}`);
    });
});

db.close();
