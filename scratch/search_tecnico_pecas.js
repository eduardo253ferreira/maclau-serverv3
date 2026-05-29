const fs = require('fs');

const content = fs.readFileSync('public/js/tecnico.js', 'utf8');
const lines = content.split('\n');

function findMatches(keyword) {
    console.log(`=== Matches for "${keyword}" ===`);
    let count = 0;
    lines.forEach((line, idx) => {
        if (line.toLowerCase().includes(keyword.toLowerCase())) {
            count++;
            if (count < 100) {
                console.log(`${idx + 1}: ${line.trim()}`);
            }
        }
    });
}

findMatches('stock');
findMatches('pecas');
