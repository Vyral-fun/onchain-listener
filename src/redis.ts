import IORedis from "ioredis";

const connection = new IORedis({
  host: Bun.env.REDIS_HOST,
  port: parseInt(Bun.env.REDIS_PORT),
  password: Bun.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
});

export default connection;
