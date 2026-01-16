import { Hono } from "hono";
import { startContractEventListener } from "../controllers/event-controllers";
import {
  getAllJobs,
  getJobClusters,
  getJobEventAddresses,
  getJobEvents,
  getJobOnchainLeaderboard,
  getJobOnchainRewards,
} from "../controllers/job-controllers";
import {
  joinOnchainInvite,
  getYapperOnchainInvites,
} from "../controllers/yapper-controllers";
import { getAddressInteractions } from "../controllers/address-controllers";

const ApiRoutes = new Hono();

ApiRoutes.post("/events/:jobId/start", startContractEventListener);
ApiRoutes.get("/:jobId/events", getJobEvents);
ApiRoutes.get("/events/jobs", getAllJobs);
ApiRoutes.get("/events/:jobId/addresses", getJobEventAddresses);
ApiRoutes.get("/events/:jobId/clusters", getJobClusters);
ApiRoutes.get("job/:jobId/leaderboard", getJobOnchainLeaderboard);
ApiRoutes.post("/jobs/:jobId/rewards", getJobOnchainRewards);

ApiRoutes.post("/yapper/invites/join/:yapperId", joinOnchainInvite);
ApiRoutes.get("/yapper/invites/:yapperId", getYapperOnchainInvites);

ApiRoutes.post("/address/interactions", getAddressInteractions);

export default ApiRoutes;
