import { Hono } from "hono";
import {
  getAllJobs,
  getJobClusters,
  getJobEventAddresses,
  getJobEvents,
  startContractEventListener,
} from "../controllers/event-controllers";
import {
  joinOnchainInvite,
  getYapperOnchainInvites,
} from "../controllers/yapper-controllers";

const ApiRoutes = new Hono();

ApiRoutes.post("/events/:jobId/start", startContractEventListener);
ApiRoutes.get("/:jobId/events", getJobEvents);
ApiRoutes.get("/events/jobs", getAllJobs);
ApiRoutes.get("/events/:jobId/addresses", getJobEventAddresses);
ApiRoutes.get("/events/:jobId/clusters", getJobClusters);

ApiRoutes.post("/yapper/invites/join/:yapperId", joinOnchainInvite);
ApiRoutes.get("/yapper/invites/:yapperId", getYapperOnchainInvites);

export default ApiRoutes;
