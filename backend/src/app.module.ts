import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health/health.controller';
import { DatabaseController } from './database/database.controller';
import { User } from './database/entities/user.entity';
import { UsersService } from './database/users.service';
import { UsersController } from './database/users.controller';

@Module({
    imports: [
        ConfigModule.forRoot(),

        TypeOrmModule.forRootAsync({
            inject: [ConfigService],
            imports: [ConfigModule],
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

    controllers: [
        HealthController,
        DatabaseController,
        UsersController
    ],

    providers: [
        UsersService
    ],
})
export class AppModule {}
