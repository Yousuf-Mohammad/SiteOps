import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/**
 * Maps errors to the platform error envelope:
 * { success: false, error: { code, message }, timestamp }
 * Known Prisma errors become curated codes; nothing internal leaks.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const timestamp = new Date().toISOString();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'object' && body !== null && 'message' in body
          ? (body as any).message
          : exception.message;
      return res.status(status).json({
        success: false,
        error: { code: exception.constructor.name.replace(/Exception$/, '').toUpperCase(), message },
        timestamp,
      });
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return res.status(HttpStatus.CONFLICT).json({
          success: false,
          error: { code: 'CONFLICT', message: 'A record with these values already exists' },
          timestamp,
        });
      }
      if (exception.code === 'P2025') {
        return res.status(HttpStatus.NOT_FOUND).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Resource not found' },
          timestamp,
        });
      }
    }

    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: { code: 'INTERNAL', message: 'Something went wrong' },
      timestamp,
    });
  }
}
