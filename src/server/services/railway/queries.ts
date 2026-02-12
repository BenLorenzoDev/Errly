// ============================================================================
// Errly — Railway GraphQL Queries (Task 6.2)
// Query strings + queryProject helper. Filter deployments by active status.
// ============================================================================

import { railwayHttpClient, circuitBreaker } from './client.js';
import { logger } from '../../utils/logger.js';

// --- GraphQL Query Strings ---

export const PROJECT_QUERY = `
  query project($projectId: String!) {
    project(id: $projectId) {
      id
      name
      services {
        edges {
          node {
            id
            name
          }
        }
      }
      environments {
        edges {
          node {
            id
            name
            deployments(first: 5) {
              edges {
                node {
                  id
                  status
                  staticUrl
                  serviceId
                  environment {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const DEPLOYMENT_LOGS_QUERY = `
  query deploymentLogs($deploymentId: String!, $limit: Int) {
    deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
      timestamp
      message
      severity
    }
  }
`;

// --- Types for query results ---

export interface RailwayService {
  id: string;
  name: string;
}

export interface RailwayDeployment {
  id: string;
  status: string;
  staticUrl: string | null;
  serviceId: string;
  serviceName: string;
  environmentId: string;
  environmentName: string;
}

export interface ProjectData {
  id: string;
  name: string;
  services: RailwayService[];
  deployments: RailwayDeployment[];
}

// Raw GraphQL response shapes
interface RawProjectResponse {
  project: {
    id: string;
    name: string;
    services: {
      edges: Array<{
        node: {
          id: string;
          name: string;
        };
      }>;
    };
    environments: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          deployments: {
            edges: Array<{
              node: {
                id: string;
                status: string;
                staticUrl: string | null;
                serviceId: string;
                environment: {
                  id: string;
                  name: string;
                };
              };
            }>;
          };
        };
      }>;
    };
  };
}

// Active deployment statuses — skip CRASHED, REMOVED, FAILED
const ACTIVE_STATUSES = new Set([
  'SUCCESS',
  'DEPLOYING',
  'INITIALIZING',
  'BUILDING',
  'WAITING',
  'SLEEPING',
]);

// --- Query project and transform to flat structure ---

export async function queryProject(
  projectId: string,
  token: string,
): Promise<ProjectData> {
  if (circuitBreaker.isOpen()) {
    throw new Error('Circuit breaker is OPEN — cannot query project');
  }

  if (circuitBreaker.hasAuthError()) {
    throw new Error('Railway API token is invalid — cannot query project');
  }

  const { data } = await railwayHttpClient<RawProjectResponse>(
    PROJECT_QUERY,
    { projectId },
    token,
  );

  if (!data?.project) {
    throw new Error('No project data returned from Railway API');
  }

  const project = data.project;

  // Build service ID → name map
  const serviceMap = new Map<string, string>();
  const services: RailwayService[] = [];

  for (const edge of project.services.edges) {
    const svc = edge.node;
    serviceMap.set(svc.id, svc.name);
    services.push({ id: svc.id, name: svc.name });
  }

  // Flatten deployments from all environments, filter by active status
  const deployments: RailwayDeployment[] = [];
  const seenServiceIds = new Set<string>();

  for (const envEdge of project.environments.edges) {
    const env = envEdge.node;

    for (const depEdge of env.deployments.edges) {
      const dep = depEdge.node;

      // Skip non-active deployments
      if (!ACTIVE_STATUSES.has(dep.status)) {
        continue;
      }

      // Only take the first (latest) active deployment per service per environment
      const key = `${dep.serviceId}:${env.id}`;
      if (seenServiceIds.has(key)) continue;
      seenServiceIds.add(key);

      deployments.push({
        id: dep.id,
        status: dep.status,
        staticUrl: dep.staticUrl,
        serviceId: dep.serviceId,
        serviceName: serviceMap.get(dep.serviceId) ?? `unknown-${dep.serviceId}`,
        environmentId: env.id,
        environmentName: dep.environment?.name ?? env.name,
      });
    }
  }

  logger.info('Project query completed', {
    projectId,
    projectName: project.name,
    services: services.length,
    activeDeployments: deployments.length,
  });

  return {
    id: project.id,
    name: project.name,
    services,
    deployments,
  };
}
