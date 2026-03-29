import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClinicServiceEntity } from './entities/clinic-service.entity';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { UserModule } from '../user/user.module';
import { AdminModule } from '../admin/admin.module';
import { ServiceCategoryEntity } from './entities/service-category.entity';
import { ConfigModule } from '@nestjs/config';
import { DoctorModule } from '../doctor/doctor.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([ClinicServiceEntity, ServiceCategoryEntity]),
        UserModule,
        AdminModule,
        DoctorModule,
        ConfigModule,
    ],
    providers: [ServicesService],
    controllers: [ServicesController],
    exports: [ServicesService],
})
export class ServicesModule {}
