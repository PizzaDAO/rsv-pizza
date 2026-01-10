import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code?: string
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
  console.error('Error:', err);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        message: err.message,
        code: err.code,
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

  // Generic error
  res.status(500).json({
    error: { message: 'Internal server error', code: 'INTERNAL_ERROR' },
  });
};
