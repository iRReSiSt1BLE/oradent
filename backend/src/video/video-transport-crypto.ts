import { createDecipheriv, createHash } from 'crypto';

function deriveTransportKey(secret: string): Buffer {
    return createHash('sha256').update(secret).digest();
}

export function decryptAgentTransportPayload(params: {
    encryptedBuffer: Buffer;
    secret: string;
    ivBase64: string;
    authTagBase64: string;
}): Buffer {
    const decipher = createDecipheriv(
        'aes-256-gcm',
        deriveTransportKey(params.secret),
        Buffer.from(params.ivBase64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(params.authTagBase64, 'base64'));
    return Buffer.concat([
        decipher.update(params.encryptedBuffer),
        decipher.final(),
    ]);
}
