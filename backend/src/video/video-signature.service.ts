import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { generateKeyPairSync, sign } from 'crypto';

@Injectable()
export class VideoSignatureService {
    constructor(private readonly configService: ConfigService) {}

    private ensureKeyPairExists(): {
        privateKeyPem: string;
        publicKeyPem: string;
    } {
        const privateKeyPath = this.configService.get<string>('VIDEO_PRIVATE_KEY_PATH');
        const publicKeyPath = this.configService.get<string>('VIDEO_PUBLIC_KEY_PATH');

        if (!privateKeyPath || !publicKeyPath) {
            throw new InternalServerErrorException(
                'Не задано VIDEO_PRIVATE_KEY_PATH або VIDEO_PUBLIC_KEY_PATH',
            );
        }

        const privateDir = path.dirname(privateKeyPath);
        const publicDir = path.dirname(publicKeyPath);

        fs.mkdirSync(privateDir, { recursive: true });
        fs.mkdirSync(publicDir, { recursive: true });

        const privateExists = fs.existsSync(privateKeyPath);
        const publicExists = fs.existsSync(publicKeyPath);

        if (!privateExists || !publicExists) {
            const { privateKey, publicKey } = generateKeyPairSync('ed25519');

            const privateKeyPem = privateKey.export({
                type: 'pkcs8',
                format: 'pem',
            }) as string;

            const publicKeyPem = publicKey.export({
                type: 'spki',
                format: 'pem',
            }) as string;

            fs.writeFileSync(privateKeyPath, privateKeyPem, 'utf-8');
            fs.writeFileSync(publicKeyPath, publicKeyPem, 'utf-8');
        }

        return {
            privateKeyPem: fs.readFileSync(privateKeyPath, 'utf-8'),
            publicKeyPem: fs.readFileSync(publicKeyPath, 'utf-8'),
        };
    }

    signManifest(manifestObject: object): {
        signatureBase64: string;
        algorithm: string;
    } {
        const { privateKeyPem } = this.ensureKeyPairExists();

        const manifestString = JSON.stringify(manifestObject);
        const signatureBuffer = sign(null, Buffer.from(manifestString), privateKeyPem);

        return {
            signatureBase64: signatureBuffer.toString('base64'),
            algorithm: 'Ed25519',
        };
    }
}