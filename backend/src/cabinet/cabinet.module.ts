import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cabinet } from './entities/cabinet.entity';
import { CabinetDevice } from './entities/cabinet-device.entity';
import { CabinetDoctor } from './entities/cabinet-doctor.entity';
import { Doctor } from '../doctor/entities/doctor.entity';
import { ClinicServiceEntity } from '../services/entities/clinic-service.entity';
import { CabinetController } from './cabinet.controller';
import { CabinetService } from './cabinet.service';
import { UserModule } from '../user/user.module';
import { AdminModule } from '../admin/admin.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Cabinet,
            CabinetDevice,
            CabinetDoctor,
            Doctor,
            ClinicServiceEntity,
        ]),
        UserModule,
        AdminModule,
    ],
    controllers: [CabinetController],
    providers: [CabinetService],
    exports: [CabinetService],
})
export class CabinetModule {}
