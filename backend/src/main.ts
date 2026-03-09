import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule);

    app.enableCors({
        origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
        credentials: true,
    });

    app.useGlobalPipes(new ValidationPipe({ transform: true }));

    await app.listen(process.env.PORT || 3000);
}

bootstrap();