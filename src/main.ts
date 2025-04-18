import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./libs/filters/http-exception.filter";
import { initDatabase } from "./shared/database/scripts/init-db";
import fastifyHelmet from '@fastify/helmet';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter as BullBoardFastifyAdapter } from '@bull-board/fastify';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
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
    
    // Set up WebSocket adapter if available
    try {
      // Dynamically import the IoAdapter to avoid TypeScript errors
      const { IoAdapter } = await import('@nestjs/platform-socket.io');
      app.useWebSocketAdapter(new IoAdapter(app));
      logger.log('WebSocket adapter initialized successfully');
    } catch (error) {
      logger.warn(`WebSocket adapter could not be initialized. Websocket functionality will be disabled: ${error.message}`);
    }

    // Security headers
    await app.register(fastifyHelmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: [`'self'`],
          styleSrc: [`'self'`, `'unsafe-inline'`],
          imgSrc: [`'self'`, 'data:', 'validator.swagger.io'],
          scriptSrc: [`'self'`, `'unsafe-inline'`, `'unsafe-eval'`],
          connectSrc: [`'self'`],
          fontSrc: [`'self'`, 'data:'],
          objectSrc: [`'none'`],
          mediaSrc: [`'self'`],
          frameSrc: [`'none'`],
        },
      }
    });

    // Get config service
    const configService = app.get(ConfigService);
    
    // Retrieve the Bull Board adapter from the DI container
    const bullBoardAdapter = app.get<{ serverAdapter: BullBoardFastifyAdapter }>(
      'BULL_BOARD'
    ).serverAdapter;
    
    // Register the Bull Board adapter with Fastify
    // This connects the Bull Board UI to your Fastify server
    await app.register(
      (fastify, options, done) => {
        bullBoardAdapter.setBasePath('/admin/queues');
        bullBoardAdapter.registerPlugin();
        done();
      },
      { prefix: '/admin/queues' }
    );

    // Configure CORS
    app.enableCors({
      origin: configService.get('CORS_ORIGIN', '*'),
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: true,
    });
    
    // Configure Bull Board UI path in Swagger
    const config = new DocumentBuilder()
      .setTitle("Healthcare API")
      .setDescription("The Healthcare API description")
      .setVersion("1.0")
      .addBearerAuth()
      .addServer('/admin/queues', 'Bull Queue Dashboard')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api", app, document);

    // Setup graceful shutdown
    const shutdown = async () => {
      logger.log('Received shutdown signal, gracefully shutting down...');
      
      try {
        await app.close();
        logger.log('Application closed successfully');
        process.exit(0);
      } catch (err) {
        logger.error(`Error during shutdown: ${err.message}`, err.stack);
        process.exit(1);
      }
    };

    // Listen for termination signals
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Log available routes
    const httpAdapter = app.getHttpAdapter();
    const server = httpAdapter.getInstance();
    logger.log('\nAvailable Routes:');
    server.printRoutes();

    // Start the server
    const port = configService.get<number>('PORT', 3000);
    await app.listen(port, "0.0.0.0");
    logger.log(`\nApplication is running on: ${await app.getUrl()}`);
    logger.log(`Swagger documentation is available at: ${await app.getUrl()}/api`);
    logger.log(`Bull Board is available at: ${await app.getUrl()}/admin/queues`);
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

bootstrap();