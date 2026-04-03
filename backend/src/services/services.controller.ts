import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateClinicServiceDto } from './dto/create-clinic-service.dto';
import { UpdateClinicServiceDto } from './dto/update-clinic-service.dto';
import { CreateServiceCategoryDto } from './dto/create-service-category.dto';
import { UpdateServiceCategoryDto } from './dto/update-service-category.dto';

@Controller('services')
export class ServicesController {
    constructor(private readonly servicesService: ServicesService) {}

    @Get('public/catalog')
    getPublicCatalog() {
        return this.servicesService.getPublicCatalog();
    }

    @Get('public/active')
    getActivePublic() {
        return this.servicesService.getActivePublic();
    }

    @Get('public/:id')
    getPublicServiceById(@Param('id', new ParseUUIDPipe()) id: string) {
        return this.servicesService.getPublicServiceById(id);
    }

    @UseGuards(JwtAuthGuard)
    @Get('categories')
    getCategoriesForAdmin(@Req() req: { user: { id: string } }) {
        return this.servicesService.getCategoriesForAdmin(req.user.id);
    }

    @UseGuards(JwtAuthGuard)
    @Post('categories')
    createCategory(
        @Req() req: { user: { id: string } },
        @Body() dto: CreateServiceCategoryDto,
    ) {
        return this.servicesService.createCategory(req.user.id, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Patch('categories/:id')
    updateCategory(
        @Req() req: { user: { id: string } },
        @Param('id', new ParseUUIDPipe()) id: string,
        @Body() dto: UpdateServiceCategoryDto,
    ) {
        return this.servicesService.updateCategory(req.user.id, id, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Patch('categories/:id/toggle-active')
    toggleCategoryActive(
        @Req() req: { user: { id: string } },
        @Param('id', new ParseUUIDPipe()) id: string,
    ) {
        return this.servicesService.toggleCategoryActive(req.user.id, id);
    }

    @UseGuards(JwtAuthGuard)
    @Get('specialties/options')
    getSpecialtiesForAssignment(@Req() req: { user: { id: string } }) {
        return this.servicesService.getSpecialtiesForAssignment(req.user.id);
    }

    @UseGuards(JwtAuthGuard)
    @Get()
    getAllForAdmin(@Req() req: { user: { id: string } }) {
        return this.servicesService.getAllForAdmin(req.user.id);
    }

    @UseGuards(JwtAuthGuard)
    @Post()
    create(
        @Req() req: { user: { id: string } },
        @Body() dto: CreateClinicServiceDto,
    ) {
        return this.servicesService.create(req.user.id, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Patch(':id')
    update(
        @Req() req: { user: { id: string } },
        @Param('id', new ParseUUIDPipe()) id: string,
        @Body() dto: UpdateClinicServiceDto,
    ) {
        return this.servicesService.update(req.user.id, id, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Patch(':id/toggle-active')
    toggleActive(
        @Req() req: { user: { id: string } },
        @Param('id', new ParseUUIDPipe()) id: string,
    ) {
        return this.servicesService.toggleActive(req.user.id, id);
    }
}