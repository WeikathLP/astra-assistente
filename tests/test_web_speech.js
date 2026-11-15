const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
const speechFunction = source.match(/function speechText\(text\) \{[\s\S]*?\n\}\n\nasync function speak/);
assert.ok(speechFunction, 'speechText exists');
const speechText = vm.runInNewContext(speechFunction[0].replace(/\n\nasync function speak$/, '') + '\nspeechText');

assert.equal(
  speechText('🔴 **Resumo:** disco está cheio. [Detalhes](https://example.com) ➡️ `C:\\Temp`'),
  'Resumo: disco está cheio. Detalhes C:\\Temp'
);
assert.equal(speechText('Tudo bem.\n```powershell\nGet-Volume\n```\nPróximo passo: liberar espaço.'),
  'Tudo bem. Próximo passo: liberar espaço.'
);
assert.ok(speechText('Resultado normal. '.repeat(60)).length <= 420);
console.log('Fala limpa e curta: OK');
