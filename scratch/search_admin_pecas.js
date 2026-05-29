const fs = require('fs');

const content = fs.readFileSync('public/js/admin.js', 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
    if (line.includes('pecas')) {
        console.log(`${idx + 1}: ${line.trim()}`);
    }
});
