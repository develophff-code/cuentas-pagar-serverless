#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack.js';
import { parseDeploymentStage, TARGET_REGION } from '../lib/environment.js';

const app = new cdk.App();
const stage = parseDeploymentStage(
  app.node.tryGetContext('stage') ?? process.env.DEPLOYMENT_STAGE,
);
const account = process.env.CDK_DEFAULT_ACCOUNT;
const environment: cdk.Environment = account === undefined
  ? { region: TARGET_REGION }
  : { account, region: TARGET_REGION };

new FoundationStack(app, `CuentasPagarFoundation-${stage}`, {
  stage,
  env: environment,
});
