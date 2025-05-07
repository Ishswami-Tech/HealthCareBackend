import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { ValidationPipe, Logger, LogLevel, Controller, Get } from '@nestjs/common';
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./libs/filters/http-exception.filter";
import { initDatabase } from "./shared/database/scripts/init-db";
import fastifyHelmet from '@fastify/helmet';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { swaggerConfig, swaggerCustomOptions } from './config/swagger.config';
import { LoggingService } from './shared/logging/logging.service';
import { LogType } from './shared/logging/types/logging.types';
import { LogLevel as AppLogLevel } from './shared/logging/types/logging.types';

// Logger controller for the /logger endpoint
@Controller('logger')
class LoggerController {
  constructor(private readonly loggingService: LoggingService) {}

  @Get()
  getLoggerDashboard() {
    return { 
      title: 'Application Logs',
      logs: 'Log data will be displayed here'
    };
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  let app: NestFastifyApplication;
  let loggingService: LoggingService;
  
  try {
    // Initialize database first
    await initDatabase();
    logger.log('Database initialized successfully');

    // Create the NestJS application
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({
        logger: {
          level: 'debug',
          serializers: {
            req: (req) => ({
              method: req.method,
              url: req.url,
              path: req.routerPath,
              parameters: req.params,
              headers: req.headers
            }),
            res: (res) => ({
              statusCode: res.statusCode,
              time: res.responseTime
            })
          }
        },
        trustProxy: true,
        bodyLimit: 10 * 1024 * 1024, // 10MB
        ignoreTrailingSlash: true,
        disableRequestLogging: false
      }),
      {
        logger: ['log', 'error', 'warn', 'debug', 'verbose'] as LogLevel[],
        bufferLogs: true,
        cors: {
          origin: process.env.NODE_ENV === 'production' 
            ? process.env.CORS_ORIGIN?.split(',') || ['https://ishswami.in', 'https://api.ishswami.in']
            : ['http://localhost:8088'],
          methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
          allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
          credentials: true,
          preflightContinue: false,
          optionsSuccessStatus: 204
        }
      }
    );

    // Initialize core services
    const configService = app.get(ConfigService);
    loggingService = app.get(LoggingService);
    const eventEmitter = new EventEmitter2();

    // Apply global pipes and filters
    app.useGlobalPipes(new ValidationPipe({
      transform: true,
      whitelist: true,
    }));
    app.useGlobalFilters(new HttpExceptionFilter());

    // Log application startup
    await loggingService.log(
      LogType.SYSTEM,
      AppLogLevel.INFO,
      'Application bootstrap started',
      'Bootstrap',
      { timestamp: new Date() }
    );

    // Set up WebSocket adapter with Redis
    try {
      const { IoAdapter } = await import('@nestjs/platform-socket.io');
      const { createAdapter } = await import('@socket.io/redis-adapter');
      const { createClient } = await import('redis');
      
      // Redis client configuration
      const redisConfig = {
        url: `redis://${configService.get('REDIS_HOST', 'localhost')}:${configService.get('REDIS_PORT', '6379')}`,
        password: configService.get('REDIS_PASSWORD'),
        retryStrategy: (times: number) => {
          const maxDelay = 3000;
          const delay = Math.min(times * 100, maxDelay);
          logger.log(`Redis reconnection attempt ${times}, delay: ${delay}ms`);
          return delay;
        }
      };

      // Create Redis pub/sub clients
      const pubClient = createClient(redisConfig);
      const subClient = pubClient.duplicate();

      // Enhanced Redis connection event handling
      const handleRedisError = async (client: string, err: Error) => {
        await loggingService?.log(
          LogType.ERROR,
          AppLogLevel.ERROR,
          `Redis ${client} Client Error: ${err.message}`,
          'Redis',
          { client, error: err.message, stack: err.stack }
        );
      };

      const handleRedisConnect = async (client: string) => {
        await loggingService?.log(
          LogType.SYSTEM,
          AppLogLevel.INFO,
          `Redis ${client} Client Connected`,
          'Redis',
          { client }
        );
      };

      pubClient.on('error', (err) => handleRedisError('Pub', err));
      subClient.on('error', (err) => handleRedisError('Sub', err));
      pubClient.on('connect', () => handleRedisConnect('Pub'));
      subClient.on('connect', () => handleRedisConnect('Sub'));
      
      await Promise.all([pubClient.connect(), subClient.connect()]);

      class CustomIoAdapter extends IoAdapter {
        private adapterConstructor: ReturnType<typeof createAdapter>;

        constructor(app: any) {
          super(app);
          this.adapterConstructor = createAdapter(pubClient, subClient);
        }
        
        createIOServer(port: number, options?: any) {
          // Get Socket.io path from config
          const socketPath = configService.get('SOCKET_URL', '/socket');
          const socketPathWithoutLeadingSlash = socketPath.startsWith('/') ? socketPath.substring(1) : socketPath;
          
          const server = super.createIOServer(port, {
            ...options,
            cors: {
              origin: process.env.CORS_ORIGIN?.split(',') || '*',
              methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
              credentials: true
            },
            path: `/${socketPathWithoutLeadingSlash}/`,
            serveClient: false,
            transports: ['websocket', 'polling'],
            allowEIO3: true,
            pingTimeout: 60000,
            pingInterval: 25000,
            connectTimeout: 45000,
            maxHttpBufferSize: 1e6
          });

          server.adapter(this.adapterConstructor);

          // Add health check endpoint for Socket.io
          server.of('/health').on('connection', (socket) => {
            socket.emit('health', { status: 'healthy', timestamp: new Date() });
          });

          return server;
        }
      }

      const customAdapter = new CustomIoAdapter(app);
      app.useWebSocketAdapter(customAdapter);
      
      await loggingService?.log(
        LogType.SYSTEM,
        AppLogLevel.INFO,
        'WebSocket adapter configured successfully',
        'WebSocket'
      );

    } catch (error) {
      logger.error('WebSocket initialization failed:', error);
      await loggingService?.log(
        LogType.ERROR,
        AppLogLevel.ERROR,
        `WebSocket adapter initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'WebSocket',
        { error: error instanceof Error ? error.stack : 'No stack trace available' }
      );
      throw error;
    }

    // Security headers
    await app.register(fastifyHelmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "https://api.ishswami.in", "wss://api.ishswami.in"],
          fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
          objectSrc: ["'none'"],
          frameSrc: ["'self'"],
          formAction: ["'self'"],
          baseUri: ["'self'"]
        }
      }
    });

    // Configure route handling for admin paths
    const fastifyInstance = app.getHttpAdapter().getInstance();
    fastifyInstance.addHook('onRequest', (request, reply, done) => {
      const url = request.url;
      const isAdminPath = url.startsWith('/docs') || 
                          url.startsWith('/queue-dashboard') || 
                          url.startsWith('/redis-ui') || 
                          url.startsWith('/logger') || 
                          url.startsWith('/prisma');
      
      if (isAdminPath && process.env.NODE_ENV === 'production') {
        // Add additional security checks for admin paths in production
        // This is just a placeholder for your actual security implementation
        const auth = request.headers.authorization;
        if (!auth) {
          reply.status(401).send({ message: 'Authentication required for admin paths' });
          return;
        }
      }
      
      done();
    });

    // Handle direct port access redirects
    fastifyInstance.addHook('onRequest', (request, reply, done) => {
      const host = request.headers.host;
      if (host && process.env.NODE_ENV === 'production') {
        // Check if accessing via direct port
        if (host.includes(':8088')) {
          reply.header('Location', 'https://api.ishswami.in/');
          reply.status(301).send();
          return;
        } else if (host.includes(':8081')) {
          reply.header('Location', 'https://api.ishswami.in/redis-ui/');
          reply.status(301).send();
          return;
        } else if (host.includes(':5555')) {
          reply.header('Location', 'https://api.ishswami.in/prisma/');
          reply.status(301).send();
          return;
        }
      }
      done();
    });

    // Configure Swagger
    const apiUrl = configService.get('API_URL');
    const port = configService.get('PORT') || configService.get('VIRTUAL_PORT') || 8088;

    const config = new DocumentBuilder()
      .setTitle('Healthcare API')
      .setDescription('The Healthcare API description')
      .setVersion('1.0')
      .addBearerAuth()
      .addServer(apiUrl || `http://localhost:${port}`)
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);

    // Create a simple logger endpoint
    fastifyInstance.get('/logger', (request, reply) => {
      reply.send({
        title: 'Application Logs',
        logs: 'Log data will be displayed here'
      });
    });

    // Start the server
    const host = '0.0.0.0';
    
    try {
      await app.listen(port, host);
      
      // Log application startup information
      const startupInfo = {
        apiUrl: apiUrl || `http://${host}:${port}`,
        swaggerUrl: `${apiUrl}/docs`,
        bullBoardUrl: `${apiUrl}/queue-dashboard`,
        redisUrl: `${apiUrl}/redis-ui`,
        loggerUrl: `${apiUrl}/logger`,
        prismaUrl: `${apiUrl}/prisma`,
        websocketUrl: `${apiUrl}/socket`,
        environment: process.env.NODE_ENV || 'development'
      };

      await loggingService?.log(
        LogType.SYSTEM,
        AppLogLevel.INFO,
        'Application started successfully',
        'Bootstrap',
        startupInfo
      );
    } catch (listenError) {
      logger.error(`Failed to start server on ${host}:${port}:`, listenError);
      throw new Error(`Server startup failed: ${listenError.message}`);
    }

  } catch (error) {
    // Log the error using both the logger and logging service if available
    logger.error('Failed to start application:', error);
    
    if (loggingService) {
      try {
        await loggingService.log(
          LogType.ERROR,
          AppLogLevel.ERROR,
          `Failed to start application: ${error.message}`,
          'Bootstrap',
          { 
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : 'No stack trace available',
            details: error
          }
        );
      } catch (logError) {
        logger.error('Failed to log error through LoggingService:', logError);
      }
    }

    // Attempt to close the application gracefully
    try {
      if (app) {
        await app.close();
      }
    } catch (closeError) {
      logger.error('Failed to close application:', closeError);
    }

    process.exit(1);
  }
}

bootstrap().catch((error) => {
  console.error('Fatal error during bootstrap:', error);
  process.exit(1);
});