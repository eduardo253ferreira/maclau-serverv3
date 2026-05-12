const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'database.db'));

db.all("SELECT id, estado_faturacao, numero_fatura FROM avarias WHERE estado_faturacao = 'Faturado'", [], (err, rows) => {
    console.log("AVARIAS FATURADAS:", rows);
    db.all("SELECT id, estado_faturacao, numero_fatura FROM servicos WHERE estado_faturacao = 'Faturado'", [], (err, rows) => {
        console.log("SERVICOS FATURADOS:", rows);
        db.all("SELECT id, estado_faturacao, numero_fatura FROM manutencoes WHERE estado_faturacao = 'Faturado'", [], (err, rows) => {
            console.log("MANUTENCOES FATURADAS:", rows);
            db.close();
        });
    });
});
