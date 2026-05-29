const fs = require('fs');

const content = fs.readFileSync('server.js', 'utf8');
const lines = content.split('\n');

function findMatches(keyword) {
    console.log(`=== Matches for "${keyword}" ===`);
    lines.forEach((line, idx) => {
        if (line.toLowerCase().includes(keyword.toLowerCase())) {
            console.log(`${idx + 1}: ${line.trim()}`);
        }
    });
}

findMatches('produto');
findMatches('quantidade');
