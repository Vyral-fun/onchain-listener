import connection from "@/redis";

export async function flushQueue() {
  try {
    await connection.flushall();
    console.log("Done");
  } catch (error) {
    console.error("Failed to flush ", error);
  }
}

flushQueue();
//process.exit(0);
