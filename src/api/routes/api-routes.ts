import { Hono } from "hono";
import {
  getAllJobs,
  getJobEventAddresses,
  getJobEvents,
  startContractEventListener,
  stopContractEventListener,
} from "../controllers/event-controllers";

const ApiRoutes = new Hono();

ApiRoutes.post("/events/:jobId/start", startContractEventListener);
ApiRoutes.post("/events/:jobId/stop", stopContractEventListener);
ApiRoutes.get("/:jobId/events", getJobEvents);
ApiRoutes.get("/events/jobs", getAllJobs);
ApiRoutes.get("/events/:jobId/addresses", getJobEventAddresses);

export default ApiRoutes;
