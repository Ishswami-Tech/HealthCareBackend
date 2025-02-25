import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./libs/filters/http-exception.filter";
import { initDatabase } from "./shared/database/scripts/init-db";

async function bootstrap() {
  try {
    await initDatabase();

    const app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter()
    );

    app.useGlobalPipes(new ValidationPipe({
      transform: true,
      whitelist: true,
    }));
    app.useGlobalFilters(new HttpExceptionFilter());

    const config = new DocumentBuilder()
      .setTitle("Healthcare API")
      .setDescription("The Healthcare API description")
      .setVersion("1.0")
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api", app, document);

    await app.listen(process.env.PORT || 3000, "0.0.0.0");
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

bootstrap();
