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
import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';

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

    // Security headers
    await app.register(fastifyHelmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: [`'self'`],
          styleSrc: [`'self'`, `'unsafe-inline'`],
          imgSrc: [`'self'`, 'data:', 'validator.swagger.io'],
          scriptSrc: [`'self'`, `https: 'unsafe-inline'`],
        },
      }
    });

    // CORS configuration
    await app.register(fastifyCors, {
      origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
      methods: process.env.CORS_METHODS || 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: process.env.CORS_CREDENTIALS === 'true',
      allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'X-Requested-With'],
      exposedHeaders: ['Content-Range', 'X-Content-Range'],
      maxAge: 86400 // 24 hours
    });

    const config = new DocumentBuilder()
      .setTitle("Healthcare API")
      .setDescription("The Healthcare API description")
      .setVersion("1.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api", app, document);

    const httpAdapter = app.getHttpAdapter();
    const server = httpAdapter.getInstance();
    console.log('\nAvailable Routes:');
    server.printRoutes();

    await app.listen(process.env.PORT || 8088, "0.0.0.0");
    console.log(`\nApplication is running on: ${await app.getUrl()}`);
    console.log(`Swagger documentation is available at: ${await app.getUrl()}/api`);
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

bootstrap();
