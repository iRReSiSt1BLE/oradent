import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from '../user/user.module';
import { HomeContentController } from './home-content.controller';
import { HomeContentService } from './home-content.service';
import { HomeContentBlock } from './entities/home-content-block.entity';

@Module({
    imports: [TypeOrmModule.forFeature([HomeContentBlock]), UserModule],
    controllers: [HomeContentController],
    providers: [HomeContentService],
    exports: [HomeContentService],
})
export class HomeContentModule {}
