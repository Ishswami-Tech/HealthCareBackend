export default () => ({
  database: {
    url: process.env.DATABASE_URL_PROD,
  },
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  kafka: {
    brokers: process.env.KAFKA_BROKERS?.split(',') || ['kafka:29092'],
  },
}); 