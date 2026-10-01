#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack.js';
import { ApplicationStack } from '../lib/application-stack.js';
import { DataStack } from '../lib/data-stack.js';
import { BusinessStack } from '../lib/business-stack.js';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { parseDeploymentStage, TARGET_REGION } from '../lib/environment.js';
import { infrastructurePlan, parseInfrastructureProfile } from '../lib/infrastructure-profile.js';

const app = new cdk.App();
const plan = infrastructurePlan(
  parseInfrastructureProfile(app.node.tryGetContext('infrastructureProfile')),
  app.node.tryGetContext('enableBusiness') === 'true',
);
const stage = parseDeploymentStage(
  app.node.tryGetContext('stage') ?? process.env.DEPLOYMENT_STAGE,
);
const account = process.env.CDK_DEFAULT_ACCOUNT;
const environment: cdk.Environment = account === undefined
  ? { region: TARGET_REGION }
  : { account, region: TARGET_REGION };

const foundation = new FoundationStack(app, `CuentasPagarFoundation-${stage}`, {
  stage,
  env: environment,
});

new ApplicationStack(app, `CuentasPagarApplication-${stage}`, {
  stage,
  env: environment,
  runtimeConfig: foundation.runtimeConfig,
  runtimeConfigEncryptionKeyArn: foundation.encryptionKeyArn,
});

if (plan.includeData) {
  const data = new DataStack(app, `CuentasPagarData-${stage}`, { stage, env: environment, businessEgress: plan.includeBusiness });
  if (plan.includeBusiness) {
    const templateBindings: unknown = app.node.tryGetContext('ycloudTemplateBindings');
    const publicDomain: unknown = app.node.tryGetContext('publicDomain');
    new BusinessStack(app, `CuentasPagarBusiness-${stage}`, {
      stage, env: environment, data,
      runtimeConfig: foundation.runtimeConfig as unknown as secretsmanager.ISecret,
      runtimeConfigEncryptionKeyArn: foundation.encryptionKeyArn,
      enableSchedules: app.node.tryGetContext('enableSchedules') === 'true',
      ...(typeof templateBindings === 'string' ? { templateBindings } : {}),
      ...(typeof publicDomain === 'string' ? { publicDomain } : {}),
    });
  }
}
