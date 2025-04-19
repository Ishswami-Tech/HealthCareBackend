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
      // Dynamically import the IoAdapter and createAdapter to avoid TypeScript errors
      const { IoAdapter } = await import('@nestjs/platform-socket.io');
      const { createAdapter } = await import('@socket.io/redis-streams-adapter');
      const { createClient } = await import('redis');
      const { instrument } = await import('@socket.io/admin-ui');
      
      const redisClient = createClient({
        url: `redis://${process.env.REDIS_HOST || (process.env.NODE_ENV === 'production' ? 'redis' : 'localhost')}:${process.env.REDIS_PORT || '6379'}`,
        password: process.env.REDIS_PASSWORD,
      });

      await redisClient.connect();

      class CustomIoAdapter extends IoAdapter {
        constructor(private app: any) {
          super(app);
        }
        
        createIOServer(port: number, options?: any) {
          const server = super.createIOServer(port, {
            cors: {
              origin: ["https://admin.socket.io"],
              credentials: true
            },
            adapter: createAdapter(redisClient)
          });
          
          // Set up Socket.IO Admin UI
          instrument(server, {
            auth: {
              type: "basic",
              username: "admin",
              password: "$2a$10$toNinhAQwXmVekZrNrRrh.9BCQS.iY9GslqYodhlAc0/KW9X0RXkC" // "admin" encrypted with bcryptjs
            },
            mode: "development",
            namespaceName: "/admin",
            readonly: false,
            serverId: "healthcare-api"
          });
          
          return server;
        }
      }

      const customAdapter = new CustomIoAdapter(app);
      app.useWebSocketAdapter(customAdapter);
      logger.log('WebSocket adapter initialized successfully');
      logger.log('Socket.IO Admin UI is available at https://admin.socket.io');
      logger.log('Use http://localhost:8088 as the Server URL when connecting');

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
          connectSrc: [`'self'`, 'wss://admin.socket.io', 'https://admin.socket.io', 'ws://localhost:8088', 'http://localhost:8088'],
          fontSrc: [`'self'`, 'data:'],
          objectSrc: [`'none'`],
          mediaSrc: [`'self'`],
          frameSrc: [`'none'`],
          frameAncestors: [`'none'`]
        },
      }
    });

    // Get config service
    const configService = app.get(ConfigService);

    // Configure CORS with specific origins
    const corsOrigins = configService.get('CORS_ORIGIN', '*').split(',').map(origin => origin.trim());
    await app.enableCors({
      origin: corsOrigins,
      methods: configService.get('CORS_METHODS', ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']),
      credentials: configService.get('CORS_CREDENTIALS', true),
    });
    
    // Configure Swagger
    const config = new DocumentBuilder()
      .setTitle("Healthcare API")
      .setDescription("The Healthcare API description")
      .setVersion("1.0")
      .addBearerAuth()
      .addServer('/admin/queues', 'Bull Queue Dashboard')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("docs", app, document);

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

    // Start the server
    const port = configService.get<number>('PORT', 3000);
    await app.listen(port, "0.0.0.0");
    logger.log(`\nApplication is running on: ${await app.getUrl()}`);
    logger.log(`Swagger documentation is available at: ${await app.getUrl()}/docs`);
    logger.log(`Bull Board is available at: ${await app.getUrl()}/admin/queues`);
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

bootstrap();