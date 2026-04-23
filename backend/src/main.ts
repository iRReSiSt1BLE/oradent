import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { WsAdapter } from '@nestjs/platform-ws';

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule);

    app.enableCors({
        origin: [
            'http://localhost:5173',
            'https://oradent.khokhol-maxim.com',
        ],
        credentials: true,
    });

    app.useWebSocketAdapter(new WsAdapter(app));

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    );

    await app.listen(process.env.PORT || 3000);
}

bootstrap();