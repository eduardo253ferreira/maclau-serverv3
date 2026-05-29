const fs = require('fs');
const content = fs.readFileSync('public/tecnico.html', 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
    if (line.includes('pecas') || line.includes('stock')) {
        console.log(`${idx + 1}: ${line.trim()}`);
    }
});
