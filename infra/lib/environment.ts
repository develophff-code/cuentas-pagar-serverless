export const DEPLOYMENT_STAGES = ['dev', 'staging', 'prod'] as const;
export type DeploymentStage = (typeof DEPLOYMENT_STAGES)[number];

export const TARGET_REGION = 'us-east-1';

export function parseDeploymentStage(value: string | undefined): DeploymentStage {
  if (value === undefined) {
    return 'dev';
  }

  if ((DEPLOYMENT_STAGES as readonly string[]).includes(value)) {
    return value as DeploymentStage;
  }

  throw new Error(`Stage inválido: ${value}. Valores permitidos: ${DEPLOYMENT_STAGES.join(', ')}.`);
}

