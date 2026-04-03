type AnyDecorator = (...decoratorArgs: readonly unknown[]) => void;
type DecoratorFactory = (...args: readonly unknown[]) => AnyDecorator;

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

export class DocumentBuilder {
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

export const SwaggerModule = {
  createDocument(..._args: unknown[]): SwaggerDocument {
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
    // Intentionally no-op. This shim preserves app startup while removing the
    // vulnerable runtime dependency before upstream publishes a fixed release.
  },
};

export const ApiTags: DecoratorFactory = noopDecoratorFactory;
export const ApiBearerAuth: DecoratorFactory = noopDecoratorFactory;
export const ApiSecurity: DecoratorFactory = noopDecoratorFactory;
export const ApiOperation: DecoratorFactory = noopDecoratorFactory;
export const ApiResponse: DecoratorFactory = noopDecoratorFactory;
export const ApiParam: DecoratorFactory = noopDecoratorFactory;
export const ApiBody: DecoratorFactory = noopDecoratorFactory;
export const ApiExcludeEndpoint: DecoratorFactory = noopDecoratorFactory;
export const ApiQuery: DecoratorFactory = noopDecoratorFactory;
export const ApiConsumes: DecoratorFactory = noopDecoratorFactory;
export const ApiProduces: DecoratorFactory = noopDecoratorFactory;
export const ApiHeader: DecoratorFactory = noopDecoratorFactory;
export const ApiOkResponse: DecoratorFactory = noopDecoratorFactory;
export const ApiExtraModels: DecoratorFactory = noopDecoratorFactory;
export const ApiProperty: DecoratorFactory = noopDecoratorFactory;
export const ApiPropertyOptional: DecoratorFactory = noopDecoratorFactory;
