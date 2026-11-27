// Same dedicated test database as the API's integration tests. Never point this at a real one.
require('reflect-metadata');
process.env.DATABASE_URL = 'postgresql://speediator:speediator@localhost:5432/speediator_test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = '0'.repeat(64);
process.env.NODE_ENV = 'test';
