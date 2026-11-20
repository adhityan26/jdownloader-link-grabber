const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');

function loadExtension(files, globals = {}) {
  const context = vm.createContext(globals);
  let result;
  for (const file of files) {
    const filename = join(__dirname, '..', 'extension', file);
    result = vm.runInContext(readFileSync(filename, 'utf8'), context, {filename});
  }
  return {result, get: name => vm.runInContext(name, context)};
}

module.exports = {loadExtension};
