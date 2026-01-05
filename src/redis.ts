import IORedis from "ioredis";

const connection = new IORedis(Bun.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export default connection;
