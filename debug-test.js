'use strict';

const sinon = require('sinon');
const assert = require('assert');

function testTranslateText() {
  // Stub the google-translate-api-x translate function
  const translateStub = sinon.stub().resolves({ text: 'Translated text' });
  sinon.stub(require('google-translate-api-x'), 'translate').callsFake(translateStub);

  // Require the translate module after setting up the stub
  const translateModule = require('./src/translate');
  const translateText = translateModule.translateText;

  console.log('Testing translateText...');
  return translateText('Hello world', 'es').then(result => {
    console.log('Result:', result);
    console.log('Result type:', typeof result);
    console.log('Result === "Hello world":', result === 'Hello world');
    console.log('Result === "Translated text":', result === 'Translated text');
    console.log('Stub called:', translateStub.calledOnce);
    if (translateStub.calledOnce) {
      const callArgs = translateStub.firstCall.args;
      console.log('Call args text:', callArgs[0]);
      console.log('Call args to:', callArgs[1].to);
    }
    sinon.restore();
    delete require.cache[require.resolve('./src/translate')];
  });
}

testTranslateText().catch(console.error);