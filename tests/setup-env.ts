// Deterministic environment for every test run. Values are non-secret fakes.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.PARSE_API_KEY ??= 'pmx_test_key';
process.env.RESEND_API_KEY ??= 're_test_key';
process.env.RESEND_FROM ??= 'RailDrop <alerts@test.local>';
process.env.CRON_SECRET ??= 'test-cron-secret-value-0123456789';
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.FARE_PROVIDER ??= 'deterministic';
process.env.RAILDROP_ALLOW_TEST_PROVIDER ??= 'i-understand-this-is-not-production';
process.env.LOG_LEVEL ??= 'error';
