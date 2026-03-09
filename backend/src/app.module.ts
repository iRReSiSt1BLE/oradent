import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { HealthController } from './health/health.controller';
import { DatabaseController } from './database/database.controller';
import { UsersController } from './database/users.controller';
import { UsersService } from './database/users.service';
import { User } from './database/entities/user.entity';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),

        ServeStaticModule.forRoot({
            rootPath: join(__dirname, '../../frontend/dist'),
            exclude: ['/api*'],
        }),

        TypeOrmModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                type: 'mysql',
                host: configService.get<string>('DB_HOST'),
                port: Number(configService.get<string>('DB_PORT', '3306')),
                username: configService.get<string>('DB_USER'),
                password: configService.get<string>('DB_PASSWORD'),
                database: configService.get<string>('DB_NAME'),
                entities: [User],
                autoLoadEntities: true,
                synchronize: true,
            }),
        }),

        TypeOrmModule.forFeature([User]),
    ],
    controllers: [HealthController, DatabaseController, UsersController],
    providers: [UsersService],
})
export class AppModule {}