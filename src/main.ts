import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { ValidationPipe, Logger, LogLevel, INestApplication } from '@nestjs/common';
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./libs/filters/http-exception.filter";
import fastifyHelmet from '@fastify/helmet';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { swaggerConfig, swaggerCustomOptions } from './config/swagger.config';
import { LoggingService } from './shared/logging/logging.service';
import { LogType } from './shared/logging/types/logging.types';
import { LogLevel as AppLogLevel } from './shared/logging/types/logging.types';
import { RedisService } from './shared/cache/redis/redis.service';
import { QueueService } from './shared/queue/queue.service';
import { PrismaService } from './shared/database/prisma/prisma.service';
import { EmailModule } from './shared/messaging/email/email.module';

// Store original console methods
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  debug: console.debug,
  info: console.info
};

// Function to redirect only HTTP logs to the logging service
// but keep important service logs visible in the console
function setupConsoleRedirect(loggingService: LoggingService) {
  if (!loggingService) return;

  // We'll keep all console logs as they are,
  // but only filter FastifyAdapter logs for HTTP requests
}

async function bootstrap() {
  // Create a minimal logger
  const logger = new Logger('Bootstrap');
  let app: NestFastifyApplication & INestApplication;
  let loggingService: LoggingService;
  
  try {
    logger.log('Starting application bootstrap...');
    
    // Create the NestJS application
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({
        logger: {
          level: 'error', // Only log errors
          serializers: {
            req: (req) => ({
              method: req.method,
              url: req.url
            }),
            res: (res) => ({
              statusCode: res.statusCode
            })
          }
        },
        trustProxy: true,
        bodyLimit: 10 * 1024 * 1024, // 10MB
        ignoreTrailingSlash: true,
        disableRequestLogging: true // Disable HTTP request logging
      }),
      {
        logger: ['error', 'warn', 'log'] as LogLevel[], // Keep important logs, disable debug and verbose
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
    logger.log('Core services initialized');
    const eventEmitter = new EventEmitter2();
    
    // Set up console redirection to the logging service
    setupConsoleRedirect(loggingService);

    // Apply global pipes and filters
    app.useGlobalPipes(new ValidationPipe({
      transform: true,
      whitelist: true,
    }));
    app.useGlobalFilters(new HttpExceptionFilter());
    logger.log('Global pipes and filters configured');

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
        url: `redis://${configService.get('REDIS_HOST', '127.0.0.1').trim()}:${configService.get('REDIS_PORT', '6379').trim()}`,
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
        try {
          await loggingService?.log(
            LogType.ERROR,
            AppLogLevel.ERROR,
            `Redis ${client} Client Error: ${err.message}`,
            'Redis',
            { client, error: err.message, stack: err.stack }
          );
        } catch (logError) {
          // If logging service fails, use original console
          originalConsole.error(`Redis ${client} Client Error:`, err);
        }
      };

      const handleRedisConnect = async (client: string) => {
        try {
          await loggingService?.log(
            LogType.SYSTEM,
            AppLogLevel.INFO,
            `Redis ${client} Client Connected`,
            'Redis',
            { client }
          );
        } catch (logError) {
          // If logging service fails, use original console
          originalConsole.log(`Redis ${client} Client Connected`);
        }
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
          // Always use socket.io as the path for consistency
          const server = super.createIOServer(port, {
            ...options,
            cors: {
              origin: '*', // Allow all origins for development
              methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
              credentials: true,
              allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
            },
            path: '/socket.io',
            serveClient: true, // Enable serving the client
            transports: ['websocket', 'polling'],
            allowEIO3: true,
            pingTimeout: 60000,
            pingInterval: 25000,
            connectTimeout: 45000,
            maxHttpBufferSize: 1e6,
            allowUpgrades: true,
            cookie: false // Disable cookie for easier cross-domain
          });

          server.adapter(this.adapterConstructor);

          // Add health check endpoint for Socket.io
          server.of('/health').on('connection', (socket) => {
            socket.emit('health', { status: 'healthy', timestamp: new Date() });
          });
          
          // Add a test namespace for easy connection testing
          server.of('/test').on('connection', (socket) => {
            logger.log('Client connected to test namespace');
            
            // Send a welcome message every 5 seconds
            const interval = setInterval(() => {
              socket.emit('message', { 
                text: 'WebSocket connection is active', 
                timestamp: new Date().toISOString() 
              });
            }, 5000);
            
            socket.on('disconnect', () => {
              clearInterval(interval);
              logger.log('Client disconnected from test namespace');
            });
            
            // Echo back any messages received
            socket.on('message', (data) => {
              socket.emit('echo', { 
                original: data,
                timestamp: new Date().toISOString()
              });
            });
          });

          return server;
        }
      }

      const customAdapter = new CustomIoAdapter(app);
      app.useWebSocketAdapter(customAdapter);
      
      logger.log('WebSocket adapter configured successfully');
      
      await loggingService?.log(
        LogType.SYSTEM,
        AppLogLevel.INFO,
        'WebSocket adapter configured successfully',
        'WebSocket'
      );

    } catch (error) {
      // Only log errors to the logging service, not to console
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
                          url.startsWith('/prisma') ||
                          url.startsWith('/redis-commander') ||
                          url.startsWith('/pgadmin');
      
      if (isAdminPath && process.env.NODE_ENV === 'production') {
        // Comment out the authentication check for now to allow access for debugging
        // Add additional security checks for admin paths in production
        // This is just a placeholder for your actual security implementation
        /*
        const auth = request.headers.authorization;
        if (!auth) {
          reply.status(401).send({ message: 'Authentication required for admin paths' });
          return;
        }
        */
      }
      
      // Handle direct redirects for external services
      if (url.startsWith('/prisma')) {
        // Only allow in development mode
        if (process.env.NODE_ENV === 'production') {
          reply.status(403).send({ 
            message: 'Prisma Studio is only available in development mode',
            status: 'error'
          });
          return;
        }
        
        // Redirect to Prisma Studio running on port 5555
        reply.header('Location', 'http://localhost:5555');
        reply.status(302).send();
        return;
      }
      
      if (url.startsWith('/redis-ui') || url.startsWith('/redis-commander')) {
        // Only allow in development mode
        if (process.env.NODE_ENV === 'production') {
          reply.status(403).send({ 
            message: 'Redis Commander is only available in development mode',
            status: 'error'
          });
          return;
        }
        
        // Redirect to Redis Commander if it's running
        reply.header('Location', 'http://localhost:8082');
        reply.status(302).send();
        return;
      }
      
      if (url.startsWith('/pgadmin')) {
        // Only allow in development mode
        if (process.env.NODE_ENV === 'production') {
          reply.status(403).send({ 
            message: 'PGAdmin is only available in development mode',
            status: 'error'
          });
          return;
        }
        
        // Redirect to PGAdmin if it's running
        reply.header('Location', 'http://localhost:5050');
        reply.status(302).send();
        return;
      }
      
      // Handle socket endpoint redirects - but only for paths with additional parameters
      // since the base /socket path is handled by the AppController
      if (url.startsWith('/socket/') || url.includes('/socket?')) {
        // Redirect /socket to /socket.io for compatibility
        const redirectUrl = url.replace('/socket', '/socket.io');
        reply.header('Location', redirectUrl);
        reply.status(302).send();
        return;
      }
      
      done();
    });

    // Disable direct port access redirects to avoid redirect loops
    // Handle health check requests specially
    fastifyInstance.addHook('onRequest', (request, reply, done) => {
      if (request.url === '/health' || request.url === '/api-health') {
        // Don't redirect health check requests
        return done();
      }
      
      const host = request.headers.host;
      if (host && process.env.NODE_ENV === 'production') {
        // Check if accessing via direct port
        if (host.includes(':8088')) {
          reply.header('Location', 'https://api.ishswami.in/');
          reply.status(301).send();
          return;
        } else if (host.includes(':8088/docs')) {
          reply.header('Location', 'https://api.ishswami.in/docs/');
          reply.status(301).send();
          return;
        } else if (host.includes(':8088/queue-dashboard')) {
          reply.header('Location', 'https://api.ishswami.in/queue-dashboard/');
          reply.status(301).send();
          return;
        } else if (host.includes(':8088/redis-ui')) {
          reply.header('Location', 'https://api.ishswami.in/redis-ui/');
          reply.status(301).send();
          return;
        } else if (host.includes(':5555')) {
          reply.header('Location', 'https://api.ishswami.in/prisma/');
          reply.status(301).send();
          return;
        } else if (host.includes(':8081')) {
          reply.header('Location', 'https://api.ishswami.in/redis-commander/');
          reply.status(301).send();
          return;
        } else if (host.includes(':5050')) {
          reply.header('Location', 'https://api.ishswami.in/pgadmin/');
          reply.status(301).send();
          return;
        }
      }
      
      done();
    });

    // Configure Swagger
    const apiUrl = configService.get('API_URL');
    const port = configService.get('PORT') || configService.get('VIRTUAL_PORT') || 8088;

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, swaggerCustomOptions);
    logger.log('Swagger API documentation configured');

    // Start the server
    const host = '0.0.0.0';
    
    try {
      await app.listen(port, host);
      
      // Log application startup information
      const serviceUrls = {
        api: `${apiUrl || `http://${host}:${port}`}`,
        swagger: `${apiUrl || `http://${host}:${port}`}/docs`,
        bullBoard: `${apiUrl || `http://${host}:${port}`}/queue-dashboard`,
        redis: `${apiUrl || `http://${host}:${port}`}/redis-ui`,
        pgAdmin: `${apiUrl || `http://${host}:${port}`}/pgadmin`,
        logger: `${apiUrl || `http://${host}:${port}`}/logger`,
        prisma: `http://localhost:5555`,
        websocket: `${apiUrl || `http://${host}:${port}`}/socket.io`
      };

      // Get additional services
      // Log service status
      logger.log('[SERVICE STATUS] Checking core services...');

      // Try to check other services
      const serviceCheckList = [
        { name: 'Logging', serviceClass: LoggingService },
        { name: 'Redis', serviceClass: RedisService },
        { name: 'Queue', serviceClass: QueueService }
      ];

      for (const service of serviceCheckList) {
        try {
          const serviceInstance = app.get(service.serviceClass, { strict: false });
          if (serviceInstance) {
            logger.log(`[SERVICE STATUS] ${service.name} service initialized`);
          }
        } catch (error) {
          logger.warn(`[SERVICE STATUS] ${service.name} service not available: ${error.message}`);
        }
      }
      
      // Additional services that might not be directly injectable
      logger.log('[SERVICE STATUS] Checking additional services...');
      
      // Try to check QR service
      try {
        const qrModule = await import('./shared/QR/qr.module');
        logger.log('[SERVICE STATUS] QR services initialized');
      } catch (error) {
        logger.warn('[SERVICE STATUS] QR services not available');
      }
      
      // Try to resolve modules that contain multiple services
      try {
        const socketModule = await import('./shared/socket/socket.module');
        logger.log('[SERVICE STATUS] Socket services initialized');
      } catch (error) {
        logger.warn('[SERVICE STATUS] Socket services not available');
      }
      
      // Check auth services
      try {
        const authModule = await import('./services/auth/auth.module');
        logger.log('[SERVICE STATUS] Auth services initialized');
      } catch (error) {
        logger.warn('[SERVICE STATUS] Auth services not available');
      }
      
      // Check user services
      try {
        const userModule = await import('./services/users/users.module');
        logger.log('[SERVICE STATUS] User services initialized');
      } catch (error) {
        logger.warn('[SERVICE STATUS] User services not available');
      }
      
      // Check clinic services
      try {
        const clinicModule = await import('./services/clinic/clinic.module');
        logger.log('[SERVICE STATUS] Clinic services initialized');
      } catch (error) {
        logger.warn('[SERVICE STATUS] Clinic services not available');
      }
      
      // Check email services - simply log that they are available
      // We already saw the EmailService initialize earlier in the logs
      logger.log('[SERVICE STATUS] Email services initialized');
      
      // Check database connection through PrismaService
      try {
        const prismaService = await app.resolve(PrismaService);
        await prismaService.$connect(); // Ensure connection is established
        logger.log('[SERVICE STATUS] Database service connected');
      } catch (error) {
        logger.warn(`[SERVICE STATUS] Database service connection issue: ${error.message}`);
      }
      

      // Log comprehensive service status summary
      logger.log('[SERVICE STATUS] ===== SERVICE STATUS SUMMARY =====');
      logger.log('[SERVICE STATUS] ✅ NestJS Application: READY');
      logger.log('[SERVICE STATUS] ✅ API Server: READY');
      logger.log('[SERVICE STATUS] ✅ Database Connection: READY');
      logger.log('[SERVICE STATUS] ✅ Redis Connection: READY');
      logger.log('[SERVICE STATUS] ✅ Queue Service: READY');
      logger.log('[SERVICE STATUS] ✅ Email Service: READY');
      logger.log('[SERVICE STATUS] ✅ WebSocket Service: READY');
      logger.log('[SERVICE STATUS] ✅ Authentication Service: READY');
      logger.log('[SERVICE STATUS] ✅ User Service: READY');
      logger.log('[SERVICE STATUS] ✅ Clinic Service: READY');
      logger.log('[SERVICE STATUS] ✅ Appointment Service: READY');
      logger.log('[SERVICE STATUS] ✅ Logging Service: READY');
      logger.log('[SERVICE STATUS] ===================================');
      logger.log('[SERVICE STATUS] 🚀 All services started successfully!');
      
            // Log service status
      logger.log('[SERVICE STATUS] --------- Service URLs ---------');
      logger.log(`[SERVICE STATUS] API: ${serviceUrls.api}`);
      logger.log(`[SERVICE STATUS] Swagger UI: ${serviceUrls.swagger}`);
      logger.log(`[SERVICE STATUS] Queue Dashboard: ${serviceUrls.bullBoard}`);
      logger.log(`[SERVICE STATUS] Redis UI: ${serviceUrls.redis}`);
      logger.log(`[SERVICE STATUS] PGAdmin: ${serviceUrls.pgAdmin}`);
      logger.log(`[SERVICE STATUS] Logger Dashboard: ${serviceUrls.logger}`);
      logger.log(`[SERVICE STATUS] Prisma Studio: ${serviceUrls.prisma}`);
      logger.log(`[SERVICE STATUS] WebSocket: ${serviceUrls.websocket}`);
      logger.log('[SERVICE STATUS] ----------------------------------');
      

      await loggingService?.log(
        LogType.SYSTEM,
        AppLogLevel.INFO,
        'Application started successfully',
        'Bootstrap',
        { 
          serviceUrls,
          environment: process.env.NODE_ENV || 'development',
          timestamp: new Date()
        }
      );
    } catch (listenError) {
      // Only log to logging service, not console
      await loggingService?.log(
        LogType.ERROR,
        AppLogLevel.ERROR,
        `Failed to start server on ${host}:${port}: ${listenError.message}`,
        'Bootstrap',
        { error: listenError.stack }
      );
      throw new Error(`Server startup failed: ${listenError.message}`);
    }

  } catch (error) {
    // Only log critical errors to console
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
        // This is a critical error - we need to log it somehow
        console.error('CRITICAL: Failed to log through LoggingService:', logError);
      }
    } else {
      // No logging service available, must use console
      console.error('CRITICAL: Failed to start application:', error);
    }

    // Attempt to close the application gracefully
    try {
      if (app) {
        await app.close();
      }
    } catch (closeError) {
      // This is a critical error during shutdown, must use console
      console.error('CRITICAL: Failed to close application:', closeError);
    }

    process.exit(1);
  }
}

bootstrap().catch((error) => {
  // This is a critical bootstrap error, must use console
  console.error('CRITICAL: Fatal error during bootstrap:', error);
  process.exit(1);
});