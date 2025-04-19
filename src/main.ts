import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { SwaggerModule } from "@nestjs/swagger";
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./libs/filters/http-exception.filter";
import { initDatabase } from "./shared/database/scripts/init-db";
import fastifyHelmet from '@fastify/helmet';
import { ConfigService } from '@nestjs/config';

import { EventEmitter2 } from '@nestjs/event-emitter';
import { swaggerConfig, swaggerCustomOptions } from './config/swagger.config';

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
    
    const configService = app.get(ConfigService);
    const eventEmitter = new EventEmitter2();

    // Set up WebSocket adapter with Redis
    try {
      const { IoAdapter } = await import('@nestjs/platform-socket.io');
      const { createAdapter } = await import('@socket.io/redis-adapter');
      const { createClient } = await import('redis');
      const { instrument } = await import('@socket.io/admin-ui');
      
      // Redis client configuration
      const redisConfig = {
        url: `redis://${configService.get('REDIS_HOST', 'localhost')}:${configService.get('REDIS_PORT', '6379')}`,
        password: configService.get('REDIS_PASSWORD'),
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          logger.log(`Redis reconnection attempt ${times}, delay: ${delay}ms`);
          return delay;
        },
        reconnectOnError: (err: Error) => {
          logger.error('Redis reconnection error:', err);
          return true;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        commandTimeout: 5000
      };

      // Create Redis pub/sub clients
      const pubClient = createClient(redisConfig);
      const subClient = pubClient.duplicate();

      // Enhanced Redis connection event handling
      const handleRedisError = (client: string, err: Error) => {
        logger.error(`Redis ${client} Client Error:`, err);
        eventEmitter.emit('redisError', { client, error: err.message });
      };

      const handleRedisConnect = (client: string) => {
        logger.log(`Redis ${client} Client Connected`);
        eventEmitter.emit('redisConnect', { client });
      };

      pubClient.on('error', (err) => handleRedisError('Pub', err));
      subClient.on('error', (err) => handleRedisError('Sub', err));
      pubClient.on('connect', () => handleRedisConnect('Pub'));
      subClient.on('connect', () => handleRedisConnect('Sub'));
      
      await Promise.all([pubClient.connect(), subClient.connect()]);

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
            adapter: createAdapter(pubClient, subClient, {
              key: 'healthcare-socket',
              publishOnSpecificResponseChannel: true,
              requestsTimeout: 5000,
              parser: {
                encode: JSON.stringify,
                decode: JSON.parse
              }
            }),
            transports: ['websocket', 'polling'],
            pingTimeout: 20000,
            pingInterval: 25000,
            upgradeTimeout: 10000,
            maxHttpBufferSize: 1e6,
            connectTimeout: 45000,
            allowEIO3: true
          });
          
          instrument(server, {
            auth: {
              type: "basic",
              username: "admin",
              password: "$2a$10$toNinhAQwXmVekZrNrRrh.9BCQS.iY9GslqYodhlAc0/KW9X0RXkC"
            },
            mode: process.env.NODE_ENV === 'production' ? "production" : "development",
            namespaceName: "/admin",
            readonly: false,
            serverId: `healthcare-api-${process.pid}`
          });
          
          return server;
        }
      }

      const customAdapter = new CustomIoAdapter(app);
      app.useWebSocketAdapter(customAdapter);

    } catch (error) {
      logger.warn(`WebSocket adapter could not be initialized: ${error.message}`);
    }

    // Security headers
    await app.register(fastifyHelmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: [`'self'`],
          styleSrc: [`'self'`, `'unsafe-inline'`],
          imgSrc: [`'self'`, 'data:', 'validator.swagger.io'],
          scriptSrc: [`'self'`, `'unsafe-inline'`, `'unsafe-eval'`],
          connectSrc: [`'self'`, 'wss://admin.socket.io', 'https://admin.socket.io', 'ws://localhost:*', 'http://localhost:*'],
          fontSrc: [`'self'`, 'data:'],
          objectSrc: [`'none'`],
          mediaSrc: [`'self'`],
          frameSrc: [`'none'`],
          frameAncestors: [`'none'`]
        },
      }
    });

    // Configure CORS
    const corsOrigins = configService.get('CORS_ORIGIN', '*').split(',').map(origin => origin.trim());
    await app.enableCors({
      origin: corsOrigins,
      methods: configService.get('CORS_METHODS', ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']),
      credentials: configService.get('CORS_CREDENTIALS', true),
    });

    // Configure Swagger
    const document = SwaggerModule.createDocument(app, swaggerConfig, {
      deepScanRoutes: true,
      operationIdFactory: (
        controllerKey: string,
        methodKey: string
      ) => methodKey
    });

    SwaggerModule.setup("docs", app, document, swaggerCustomOptions);

    // Configure route handling to prevent Bull Board from intercepting other routes
    const fastifyInstance = app.getHttpAdapter().getInstance();
    fastifyInstance.addHook('onRequest', (request, reply, done) => {
      // Skip Bull Board handling for non-queue routes
      if (!request.url.startsWith('/queue-dashboard')) {
        done();
      } else {
        done();
      }
    });

    // Start the server
    const port = configService.get<number>('PORT', 8088);
    await app.listen(port, "0.0.0.0");
    logger.log(`Application is running on: ${await app.getUrl()}`);
    logger.log(`Swagger documentation is available at: ${await app.getUrl()}/docs`);
    logger.log(`Bull Board is available at: ${await app.getUrl()}/queue-dashboard`);
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

bootstrap();