import { weatherAgent } from './weather-agent';
import { generalAgent } from './general-agent';
import { activityPlannerAgent } from './activity-planner-agent';

// The CopilotKit runtime exposes agents by these registration keys; the client
// picks one per session as `runtimeAgentId` ("weatherAgent" / "generalAgent").
export const agents = { weatherAgent, generalAgent, activityPlannerAgent };
