import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface MulterFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

interface MultipartItem {
  _buf?: Buffer;
  data?: Buffer;
  value?: Buffer | string;
  mimetype?: string;
  filename?: string;
  length?: number;
}

export const FastifyFile = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<import('fastify').FastifyRequest>();
    const fieldName = data || 'file';
    const body = (req.body || {}) as Record<string, unknown>;
    const field = body[fieldName];
    const item = (Array.isArray(field) ? field[0] : field) as
      MultipartItem | Buffer | string | undefined;

    if (!item) return null;
    if (typeof item === 'string') {
      return null; // Not a file
    }

    if (Buffer.isBuffer(item)) {
      return {
        buffer: item,
        mimetype: 'application/octet-stream',
        originalname: 'upload',
        size: item.length,
      };
    }

    const buffer = Buffer.isBuffer(item._buf)
      ? item._buf
      : Buffer.isBuffer(item.data)
        ? item.data
        : Buffer.isBuffer(item.value)
          ? item.value
          : Buffer.from('');

    return {
      buffer,
      mimetype: item.mimetype ?? 'application/octet-stream',
      originalname: item.filename ?? 'upload',
      size: buffer.length || 0,
    };
  }
);
