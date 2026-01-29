import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'RSVPizza Public API',
      version: '1.0.0',
      description: `
# RSVPizza Public API

Welcome to the RSVPizza Public API! This API allows you to programmatically manage pizza parties, guests, and receive real-time notifications via webhooks.

## Authentication

All API endpoints require authentication using an API key. Include your API key in the \`Authorization\` header:

\`\`\`
Authorization: Bearer rsvp_sk_your_api_key_here
\`\`\`

### Getting an API Key

1. Log in to your RSVPizza account
2. Request an API key via \`POST /api/v1/keys\`
3. Wait for admin approval
4. Once approved, you'll receive your API key (shown only once!)

## Rate Limiting

- Default: 500 requests per hour
- Rate limit headers are included in all responses:
  - \`X-RateLimit-Limit\`: Your rate limit
  - \`X-RateLimit-Remaining\`: Requests remaining in current window
  - \`X-RateLimit-Reset\`: Unix timestamp when the limit resets

## Scopes

API keys are granted specific scopes that control access:

| Scope | Description |
|-------|-------------|
| \`parties:read\` | Read party/event details |
| \`parties:write\` | Create/update/delete parties |
| \`guests:read\` | Read guest lists |
| \`guests:write\` | Add/update/remove guests |
| \`webhooks:read\` | List webhooks |
| \`webhooks:write\` | Create/manage webhooks |

## Webhooks

Receive real-time notifications when events occur:

| Event | Description |
|-------|-------------|
| \`party.created\` | New party created |
| \`party.updated\` | Party details updated |
| \`party.deleted\` | Party deleted |
| \`party.rsvp_closed\` | RSVPs closed |
| \`party.rsvp_opened\` | RSVPs reopened |
| \`guest.registered\` | New guest RSVP |
| \`guest.updated\` | Guest details updated |
| \`guest.approved\` | Guest approved |
| \`guest.declined\` | Guest declined |
| \`guest.removed\` | Guest removed |

### Webhook Signatures

All webhook payloads include an HMAC-SHA256 signature in the \`X-RSVPizza-Signature\` header. Verify this signature using your webhook secret to ensure the payload is authentic.

## Error Responses

All errors follow a consistent format:

\`\`\`json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": { }
  }
}
\`\`\`

| Code | HTTP Status | Description |
|------|-------------|-------------|
| \`API_KEY_REQUIRED\` | 401 | No API key provided |
| \`INVALID_API_KEY\` | 401 | Invalid or unknown API key |
| \`API_KEY_EXPIRED\` | 401 | API key has expired |
| \`INSUFFICIENT_SCOPE\` | 403 | Missing required scope |
| \`RATE_LIMIT_EXCEEDED\` | 429 | Too many requests |
| \`NOT_FOUND\` | 404 | Resource not found |
| \`VALIDATION_ERROR\` | 400 | Invalid request data |
      `,
      contact: {
        name: 'RSVPizza Support',
        url: 'https://rsv.pizza',
      },
    },
    servers: [
      {
        url: '/api/v1',
        description: 'API v1',
      },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API Key',
          description: 'API key in format: rsvp_sk_...',
        },
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token from login',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: { type: 'object' },
              },
            },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
            hasMore: { type: 'boolean' },
          },
        },
        Party: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            inviteCode: { type: 'string' },
            customUrl: { type: 'string', nullable: true },
            date: { type: 'string', format: 'date-time', nullable: true },
            endTime: { type: 'string', format: 'date-time', nullable: true },
            timezone: { type: 'string', nullable: true },
            pizzaStyle: { type: 'string' },
            address: { type: 'string', nullable: true },
            venueName: { type: 'string', nullable: true },
            maxGuests: { type: 'integer', nullable: true },
            hideGuests: { type: 'boolean' },
            requireApproval: { type: 'boolean' },
            eventImageUrl: { type: 'string', nullable: true },
            description: { type: 'string', nullable: true },
            rsvpClosedAt: { type: 'string', format: 'date-time', nullable: true },
            guestCount: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Guest: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string', nullable: true },
            ethereumAddress: { type: 'string', nullable: true },
            roles: { type: 'array', items: { type: 'string' } },
            mailingListOptIn: { type: 'boolean' },
            dietaryRestrictions: { type: 'array', items: { type: 'string' } },
            approved: { type: 'boolean', nullable: true },
            submittedAt: { type: 'string', format: 'date-time' },
            submittedVia: { type: 'string' },
          },
        },
        Webhook: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            url: { type: 'string', format: 'uri' },
            events: { type: 'array', items: { type: 'string' } },
            active: { type: 'boolean' },
            failCount: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        ApiKey: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            keyPrefix: { type: 'string' },
            scopes: { type: 'array', items: { type: 'string' } },
            rateLimit: { type: 'integer' },
            expiresAt: { type: 'string', format: 'date-time', nullable: true },
            status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
            revoked: { type: 'boolean' },
            lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    tags: [
      { name: 'Parties', description: 'Manage pizza parties' },
      { name: 'Guests', description: 'Manage party guests' },
      { name: 'Webhooks', description: 'Webhook management' },
      { name: 'API Keys', description: 'API key management (JWT auth)' },
      { name: 'Admin', description: 'Admin endpoints (super admin only)' },
    ],
  },
  apis: ['./src/routes/v1/*.ts', './dist/routes/v1/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

export function setupSwagger(app: Express): void {
  // Serve Swagger UI with CDN assets (required for serverless platforms like Vercel)
  const swaggerUiOptions = {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'RSVPizza API Documentation',
    customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui.min.css',
    customJs: [
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-bundle.js',
      'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-standalone-preset.js',
    ],
  };

  app.use(
    '/api/v1/docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, swaggerUiOptions)
  );

  // Serve raw OpenAPI spec
  app.get('/api/v1/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}

export default swaggerSpec;
