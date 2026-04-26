import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

type AnyDecorator = (...decoratorArgs: readonly unknown[]) => void;
type DecoratorFactory = (...args: readonly unknown[]) => AnyDecorator;

type LiveSwaggerModule = {
  SwaggerModule: {
    createDocument: (...args: readonly unknown[]) => SwaggerDocument;
    setup: (...args: readonly unknown[]) => void;
  };
  DocumentBuilder: new () => SwaggerDocumentBuilder;
  ApiTags: DecoratorFactory;
  ApiBearerAuth: DecoratorFactory;
  ApiSecurity: DecoratorFactory;
  ApiOperation: DecoratorFactory;
  ApiResponse: DecoratorFactory;
  ApiParam: DecoratorFactory;
  ApiBody: DecoratorFactory;
  ApiExcludeEndpoint: DecoratorFactory;
  ApiQuery: DecoratorFactory;
  ApiConsumes: DecoratorFactory;
  ApiProduces: DecoratorFactory;
  ApiHeader: DecoratorFactory;
  ApiOkResponse: DecoratorFactory;
  ApiExtraModels: DecoratorFactory;
  ApiProperty: DecoratorFactory;
  ApiPropertyOptional: DecoratorFactory;
};

type SwaggerDocumentBuilder = {
  setTitle(title: string): SwaggerDocumentBuilder;
  setDescription(description: string): SwaggerDocumentBuilder;
  setVersion(version: string): SwaggerDocumentBuilder;
  addTag(name: string, description?: string): SwaggerDocumentBuilder;
  addSecurityRequirements(name: string): SwaggerDocumentBuilder;
  addBearerAuth(options?: unknown, name?: string): SwaggerDocumentBuilder;
  addApiKey(options: Record<string, unknown>, name: string): SwaggerDocumentBuilder;
  build(): SwaggerDocument;
};

function loadLiveSwaggerModule(): LiveSwaggerModule | null {
  const liveModulePath = path.join(process.cwd(), 'node_modules', '@nestjs', 'swagger');

  if (!fs.existsSync(liveModulePath)) {
    return null;
  }

  try {
    // Use an absolute path so tsconfig path aliases do not redirect back to this shim.
    const require = createRequire(__filename);
    const loaded = require(liveModulePath) as Partial<LiveSwaggerModule>;
    if (loaded && loaded.SwaggerModule && loaded.DocumentBuilder) {
      return loaded as LiveSwaggerModule;
    }
  } catch {
    return null;
  }

  return null;
}

const liveSwagger = loadLiveSwaggerModule();

function noopDecoratorFactory(..._args: readonly unknown[]): AnyDecorator {
  return (..._decoratorArgs: readonly unknown[]) => undefined;
}

export type SwaggerCustomOptions = {
  swaggerOptions?: Record<string, unknown>;
  [key: string]: unknown;
};

type SwaggerDocument = {
  openapi: string;
  info: Record<string, unknown>;
  tags: Array<Record<string, unknown>>;
  servers: Array<Record<string, unknown>>;
  components: { securitySchemes: Record<string, unknown> };
  security: Array<Record<string, unknown>>;
  paths?: Record<string, unknown>;
};

class ShimDocumentBuilder implements SwaggerDocumentBuilder {
  private readonly document: SwaggerDocument = {
    openapi: '3.0.0',
    info: {},
    tags: [],
    servers: [],
    components: { securitySchemes: {} },
    security: [],
  };

  setTitle(title: string): this {
    this.document.info = { ...this.document.info, title };
    return this;
  }

  setDescription(description: string): this {
    this.document.info = { ...this.document.info, description };
    return this;
  }

  setVersion(version: string): this {
    this.document.info = { ...this.document.info, version };
    return this;
  }

  addTag(name: string, description?: string): this {
    this.document.tags.push({
      name,
      ...(description ? { description } : {}),
    });
    return this;
  }

  addSecurityRequirements(name: string): this {
    this.document.security.push({ [name]: [] });
    return this;
  }

  addBearerAuth(_options?: unknown, name = 'bearer'): this {
    this.document.components.securitySchemes[name] = { type: 'http', scheme: 'bearer' };
    return this;
  }

  addApiKey(options: Record<string, unknown>, name: string): this {
    this.document.components.securitySchemes[name] = options;
    return this;
  }

  build(): SwaggerDocument {
    return this.document;
  }
}

const liveDocumentBuilder = liveSwagger?.DocumentBuilder as
  | (new () => SwaggerDocumentBuilder)
  | undefined;

export const DocumentBuilder: new () => SwaggerDocumentBuilder =
  liveDocumentBuilder ?? ShimDocumentBuilder;

export const SwaggerModule = {
  createDocument(..._args: unknown[]): SwaggerDocument {
    if (liveSwagger) {
      return liveSwagger.SwaggerModule.createDocument(..._args);
    }

    return {
      openapi: '3.0.0',
      info: {},
      tags: [],
      paths: {},
      components: { securitySchemes: {} },
      servers: [],
      security: [],
    };
  },
  setup(..._args: unknown[]): void {
    if (liveSwagger) {
      liveSwagger.SwaggerModule.setup(..._args);
      return;
    }
    // Intentionally no-op. This shim preserves app startup while removing the
    // vulnerable runtime dependency before upstream publishes a fixed release.
  },
};

export const ApiTags: DecoratorFactory = liveSwagger?.ApiTags ?? noopDecoratorFactory;
export const ApiBearerAuth: DecoratorFactory = liveSwagger?.ApiBearerAuth ?? noopDecoratorFactory;
export const ApiSecurity: DecoratorFactory = liveSwagger?.ApiSecurity ?? noopDecoratorFactory;
export const ApiOperation: DecoratorFactory = liveSwagger?.ApiOperation ?? noopDecoratorFactory;
export const ApiResponse: DecoratorFactory = liveSwagger?.ApiResponse ?? noopDecoratorFactory;
export const ApiParam: DecoratorFactory = liveSwagger?.ApiParam ?? noopDecoratorFactory;
export const ApiBody: DecoratorFactory = liveSwagger?.ApiBody ?? noopDecoratorFactory;
export const ApiExcludeEndpoint: DecoratorFactory =
  liveSwagger?.ApiExcludeEndpoint ?? noopDecoratorFactory;
export const ApiQuery: DecoratorFactory = liveSwagger?.ApiQuery ?? noopDecoratorFactory;
export const ApiConsumes: DecoratorFactory = liveSwagger?.ApiConsumes ?? noopDecoratorFactory;
export const ApiProduces: DecoratorFactory = liveSwagger?.ApiProduces ?? noopDecoratorFactory;
export const ApiHeader: DecoratorFactory = liveSwagger?.ApiHeader ?? noopDecoratorFactory;
export const ApiOkResponse: DecoratorFactory = liveSwagger?.ApiOkResponse ?? noopDecoratorFactory;
export const ApiExtraModels: DecoratorFactory = liveSwagger?.ApiExtraModels ?? noopDecoratorFactory;
export const ApiProperty: DecoratorFactory = liveSwagger?.ApiProperty ?? noopDecoratorFactory;
export const ApiPropertyOptional: DecoratorFactory =
  liveSwagger?.ApiPropertyOptional ?? noopDecoratorFactory;
