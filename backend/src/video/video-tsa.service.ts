import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const execFileAsync = promisify(execFile);

@Injectable()
export class VideoTsaService {
    constructor(private readonly configService: ConfigService) {}

    async createTimestampForManifest(params: {
        manifestFullPath: string;
        recordFolderFullPath: string;
    }): Promise<{
        tsaRequestRelativeFileName: string;
        tsaResponseRelativeFileName: string;
        tsaProvider: string;
        tsaHashAlgorithm: string;
    }> {
        const tsaUrl =
            this.configService.get<string>('TSA_URL') || 'https://freetsa.org/tsr';
        const tsaHashAlgorithm =
            this.configService.get<string>('TSA_HASH_ALGORITHM') || 'sha512';

        const tsqFileName = 'request.tsq';
        const tsrFileName = 'response.tsr';

        const tsqFullPath = path.join(params.recordFolderFullPath, tsqFileName);
        const tsrFullPath = path.join(params.recordFolderFullPath, tsrFileName);

        try {
            const result = await execFileAsync('openssl', [
                'ts',
                '-query',
                '-data',
                params.manifestFullPath,
                '-no_nonce',
                `-${tsaHashAlgorithm}`,
                '-cert',
                '-out',
                tsqFullPath,
            ]);

            if (result.stderr) {
                console.warn('OpenSSL stderr:', result.stderr);
            }
        } catch (error: any) {
            const stderr = error?.stderr ? String(error.stderr) : '';
            const stdout = error?.stdout ? String(error.stdout) : '';
            const message = `OpenSSL ts-query failed. stdout: ${stdout} stderr: ${stderr}`;
            console.error(message);
            throw new InternalServerErrorException(message);
        }

        if (!fs.existsSync(tsqFullPath)) {
            throw new InternalServerErrorException(
                'TSA request file was not created',
            );
        }

        const tsqBuffer = fs.readFileSync(tsqFullPath);

        const tsrBuffer = await this.sendTimestampRequest(tsaUrl, tsqBuffer);

        try {
            fs.writeFileSync(tsrFullPath, tsrBuffer);
        } catch (error: any) {
            throw new InternalServerErrorException(
                `Не вдалося зберегти TSA response: ${String(error?.message || error)}`,
        );
        }

        return {
            tsaRequestRelativeFileName: tsqFileName,
            tsaResponseRelativeFileName: tsrFileName,
            tsaProvider: 'freeTSA',
            tsaHashAlgorithm,
        };
    }

    private sendTimestampRequest(url: string, body: Buffer): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);

            const req = https.request(
                {
                    protocol: parsedUrl.protocol,
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port || 443,
                    path: parsedUrl.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/timestamp-query',
                        'Content-Length': body.length,
                    },
                },
                (res) => {
                    const chunks: Buffer[] = [];

                    res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                    res.on('end', () => {
                        const result = Buffer.concat(chunks);

                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(result);
                        } else {
                            reject(
                                new InternalServerErrorException(
                                    `TSA returned status ${res.statusCode}. Body(base64): ${result.toString('base64')}`,
                        ),
                        );
                        }
                    });
                },
            );

            req.on('error', (error) => {
                reject(
                    new InternalServerErrorException(
                        `HTTPS request to TSA failed: ${String(error.message || error)}`,
            ),
            );
            });

            req.write(body);
            req.end();
        });
    }
}