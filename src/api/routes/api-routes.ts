import { Hono } from "hono";
import { startContractEventListener } from "../controllers/event-controllers";
import {
  getAllJobs,
  getJobClusters,
  getJobEventAddresses,
  getJobEvents,
  getJobOnchainLeaderboard,
  getJobOnchainMetrics,
  getJobOnchainRewards,
} from "../controllers/job-controllers";
import {
  joinOnchainInvite,
  getYapperOnchainInvites,
  getOnchainInviteByWallet,
} from "../controllers/yapper-controllers";

const ApiRoutes = new Hono();

ApiRoutes.post("/events/:jobId/start", startContractEventListener);
ApiRoutes.get("/:jobId/events", getJobEvents);
ApiRoutes.get("/events/jobs", getAllJobs);
ApiRoutes.get("/events/:jobId/addresses", getJobEventAddresses);
ApiRoutes.get("/events/:jobId/clusters", getJobClusters);
ApiRoutes.get("job/:jobId/leaderboard", getJobOnchainLeaderboard);
ApiRoutes.get("/job/:jobId/metrics", getJobOnchainMetrics)
ApiRoutes.post("/jobs/:jobId/rewards", getJobOnchainRewards);

ApiRoutes.post("/yapper/invites/join/:yapperId", joinOnchainInvite);
ApiRoutes.get("/yapper/invites/:yapperId", getYapperOnchainInvites);

ApiRoutes.get(
  "/invites/wallet/:walletAddress",
  getOnchainInviteByWallet
);

export default ApiRoutes;
