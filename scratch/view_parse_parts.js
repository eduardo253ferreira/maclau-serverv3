const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');
const lines = content.split('\n');

for (let i = 3700; i < 3760; i++) {
    if (lines[i] !== undefined) {
        console.log(`${i + 1}: ${lines[i]}`);
    }
}
