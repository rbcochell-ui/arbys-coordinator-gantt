import {createHash, randomBytes, webcrypto} from 'node:crypto';
import {AAD, ENVELOPE_SCHEMA, PLAIN_SCHEMA} from '../site/crypto.mjs';

export async function sealSyntheticHtml(html) {
  const keyBytes = randomBytes(32);
  const nonce = randomBytes(12);
  const plain = JSON.stringify({
    schema: PLAIN_SCHEMA,
    sha256: createHash('sha256').update(html, 'utf8').digest('hex'),
    html,
  });
  const key = await webcrypto.subtle.importKey(
    'raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await webcrypto.subtle.encrypt({
    name: 'AES-GCM', iv: nonce,
    additionalData: new TextEncoder().encode(AAD), tagLength: 128,
  }, key, new TextEncoder().encode(plain));
  return {
    keyBytes,
    envelope: {
      schema: ENVELOPE_SCHEMA,
      nonce: nonce.toString('base64url'),
      ciphertext: Buffer.from(ciphertext).toString('base64url'),
    },
  };
}
