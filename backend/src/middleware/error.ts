import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code?: string,
    // caciocavallo-58535: optional structured payload merged into the error
    // body (e.g. RECIPIENT_REQUIRED ships the candidate host list so the
    // frontend can render the recipient picker without a second round-trip).
    public data?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('Error details:', {
    name: err.name,
    message: err.message,
    stack: err.stack,
  });

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        message: err.message,
        code: err.code,
        // caciocavallo-58535: surface any structured payload (e.g. candidate
        // host list for RECIPIENT_REQUIRED) alongside the message/code.
        ...(err.data ?? {}),
      },
    });
  }

  // Prisma errors
  if (err.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as any;
    if (prismaError.code === 'P2002') {
      return res.status(409).json({
        error: { message: 'Resource already exists', code: 'DUPLICATE' },
      });
    }
    if (prismaError.code === 'P2025') {
      return res.status(404).json({
        error: { message: 'Resource not found', code: 'NOT_FOUND' },
      });
    }
  }

  res.status(500).json({
    error: {
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    },
  });
};
