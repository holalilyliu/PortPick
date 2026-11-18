const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync(path.join(__dirname, 'dist'), {recursive: true});
for (const file of ['index.html','styles.css','app.js','engine.js','catalog.js','maps-config.js']) {
  fs.copyFileSync(path.join(__dirname,file), path.join(__dirname,'dist',file));
}
console.log('PortPick static site built in dist/');
