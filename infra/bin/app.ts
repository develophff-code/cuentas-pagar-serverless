#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack.js';
import { ApplicationStack } from '../lib/application-stack.js';
import { DataStack } from '../lib/data-stack.js';
import { parseDeploymentStage, TARGET_REGION } from '../lib/environment.js';

const app = new cdk.App();
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

new DataStack(app, `CuentasPagarData-${stage}`, { stage, env: environment });
