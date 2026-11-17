import { describe, it, expect } from 'vitest';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerSpec from './swagger.js';
import { swaggerOptions } from './swaggerOptions.js';

describe('OpenAPI spec', () => {
  it('has paths including known v1 routes', () => {
    const paths = Object.keys((swaggerSpec as any).paths ?? {});
    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toContain('/api/v1/parties');
  });

  it('generated spec is up to date with route JSDoc (run npm run gen:openapi)', () => {
    const fresh = JSON.parse(JSON.stringify(swaggerJsdoc(swaggerOptions)));
    expect(JSON.parse(JSON.stringify(swaggerSpec))).toEqual(fresh);
  });
});
