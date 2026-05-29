const fs = require('fs');
const content = fs.readFileSync('public/js/admin.js', 'utf8');
const lines = content.split('\n');

for (let i = 3599; i < 3705; i++) {
    if (lines[i] !== undefined) {
        console.log(`${i + 1}: ${lines[i]}`);
    }
}
