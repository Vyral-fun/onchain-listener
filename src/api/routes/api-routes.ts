import { Hono } from "hono";
import {
  getAllJobs,
  getJobClusters,
  getJobEventAddresses,
  getJobEvents,
  startContractEventListener,
} from "../controllers/event-controllers";
import {
  addYapperReferral,
  getYapperReferrals,
} from "../controllers/yapper-controllers";

const ApiRoutes = new Hono();

ApiRoutes.post("/events/:jobId/start", startContractEventListener);
// ApiRoutes.post("/events/:jobId/stop", stopContractEventListener);
ApiRoutes.get("/:jobId/events", getJobEvents);
ApiRoutes.get("/events/jobs", getAllJobs);
ApiRoutes.get("/events/:jobId/addresses", getJobEventAddresses);
ApiRoutes.get("/events/:jobId/clusters", getJobClusters);

ApiRoutes.post("/referrals", addYapperReferral);
ApiRoutes.get("/referrals/:yapperId", getYapperReferrals);

export default ApiRoutes;
