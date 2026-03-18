import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

@Injectable()
export class VideoEncryptionService {
    constructor(private readonly configService: ConfigService) {}

    private getOrCreateKey(): Buffer {
        const keyPath = this.configService.get<string>('VIDEO_ENCRYPTION_KEY_PATH');

        if (!keyPath) {
            throw new InternalServerErrorException(
                'Не задано VIDEO_ENCRYPTION_KEY_PATH',
            );
        }

        fs.mkdirSync(path.dirname(keyPath), { recursive: true });

        if (!fs.existsSync(keyPath)) {
            const key = randomBytes(32); // 256 bit
            fs.writeFileSync(keyPath, key);
        }

        const key = fs.readFileSync(keyPath);

        if (key.length !== 32) {
            throw new InternalServerErrorException(
                'AES key must be exactly 32 bytes',
            );
        }

        return key;
    }

    encryptBuffer(buffer: Buffer): {
        encryptedBuffer: Buffer;
        ivBase64: string;
        authTagBase64: string;
        algorithm: string;
    } {
        const key = this.getOrCreateKey();
        const iv = randomBytes(12); // рекомендований розмір для GCM
        const cipher = createCipheriv('aes-256-gcm', key, iv);

        const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
        const authTag = cipher.getAuthTag();

        return {
            encryptedBuffer: encrypted,
            ivBase64: iv.toString('base64'),
            authTagBase64: authTag.toString('base64'),
            algorithm: 'AES-256-GCM',
        };
    }

    decryptBuffer(params: {
        encryptedBuffer: Buffer;
        ivBase64: string;
        authTagBase64: string;
    }): Buffer {
        const key = this.getOrCreateKey();
        const iv = Buffer.from(params.ivBase64, 'base64');
        const authTag = Buffer.from(params.authTagBase64, 'base64');

        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);

        return Buffer.concat([
            decipher.update(params.encryptedBuffer),
            decipher.final(),
        ]);
    }
}