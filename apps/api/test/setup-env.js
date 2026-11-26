// Runs in the Jest worker before any test module is imported
require('reflect-metadata');
process.env.DATABASE_URL = 'postgresql://speediator:speediator@localhost:5432/speediator_test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-at-least-32-chars!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-at-least-32-chars!';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = '0'.repeat(64);
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.NODE_ENV = 'test';
process.env.APP_URL = 'http://localhost:3000';
process.env.META_APP_ID = '1234567890';
process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = '9876543210';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'app-level-verify-token-for-tests';
