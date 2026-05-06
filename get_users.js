const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.sqlite');
db.each("SELECT username, password, role FROM users", (err, row) => console.log(row));
