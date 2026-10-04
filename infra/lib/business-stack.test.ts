import test from 'node:test';
import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DataStack } from './data-stack.js';
import { BusinessStack } from './business-stack.js';
import { MvpDataStack } from './mvp-data-stack.js';
import assert from 'node:assert/strict';

test('negocio conecta Aurora privado, autentica v1 y publica tokens sin caché; jobs desactivados', () => {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'us-east-1' };
  const foundation = new cdk.Stack(app, 'FoundationTest', { env });
  const runtimeConfig = new secretsmanager.Secret(foundation, 'Runtime');
  const data = new DataStack(app, 'DataBusinessTest', { stage: 'dev', env, businessEgress: true });
  const business = new BusinessStack(app, 'BusinessTest', { stage: 'dev', env, data,
    runtimeConfig: runtimeConfig as unknown as secretsmanager.ISecret,
    runtimeConfigEncryptionKeyArn: 'arn:aws:kms:us-east-1:123456789012:key/fixture', publicDomain: 'apagar.averiqsj.app' });
  const template = Template.fromStack(business);
  template.resourceCountIs('AWS::Lambda::Function', 5);
  template.hasResourceProperties('AWS::Lambda::Function', {
    Handler: 'src/jobs/notification-dispatch-job.handler',
    VpcConfig: { SecurityGroupIds: Match.anyValue(), SubnetIds: Match.anyValue() },
    Environment: { Variables: Match.objectLike({ NODE_EXTRA_CA_CERTS: '/var/runtime/ca-cert.pem', DATABASE_NAME: 'cuentas_pagar' }) },
  });
  template.hasResourceProperties('AWS::ApiGateway::Method', { HttpMethod: 'ANY', AuthorizationType: 'COGNITO_USER_POOLS' });
  template.hasResourceProperties('AWS::ApiGateway::Method', { HttpMethod: 'GET', AuthorizationType: 'NONE' });
  template.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(1 minute)', State: 'DISABLED' });
  template.hasResourceProperties('AWS::CloudFront::Distribution', { DistributionConfig: Match.objectLike({
    Aliases: ['apagar.averiqsj.app'], DefaultCacheBehavior: Match.objectLike({
      CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
    }),
  }) });
  Template.fromStack(data).resourceCountIs('AWS::EC2::NatGateway', 1);
});

test('MVP usa Data API, pausa Aurora y despierta dispatcher por SQS sin polling', () => {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'us-east-1' };
  const foundation = new cdk.Stack(app, 'MvpFoundation', { env });
  const runtimeConfig = new secretsmanager.Secret(foundation, 'Runtime');
  const data = new MvpDataStack(app, 'MvpData', { stage: 'dev', env });
  const business = new BusinessStack(app, 'MvpBusiness', { stage: 'dev', env, data,
    runtimeConfig: runtimeConfig as unknown as secretsmanager.ISecret,
    runtimeConfigEncryptionKeyArn: 'arn:aws:kms:us-east-1:123456789012:key/fixture' });
  const database = Template.fromStack(data);
  for (const type of ['AWS::RDS::DBProxy', 'AWS::EC2::NatGateway', 'AWS::EC2::VPCEndpoint', 'AWS::KMS::Key']) database.resourceCountIs(type, 0);
  database.hasResourceProperties('AWS::RDS::DBCluster', {
    EnableHttpEndpoint: true, StorageEncrypted: true, DeletionProtection: true, BackupRetentionPeriod: 7,
    ServerlessV2ScalingConfiguration: { MinCapacity: 0, MaxCapacity: 1, SecondsUntilAutoPause: 300 },
  });
  const template = Template.fromStack(business);
  for (const fn of Object.values(template.findResources('AWS::Lambda::Function'))) {
    assert.equal(fn.Properties.VpcConfig, undefined);
    assert.equal(fn.Properties.Environment.Variables.DATABASE_ACCESS_MODE, 'data-api');
    assert.equal(fn.Properties.ReservedConcurrentExecutions, 2);
  }
  template.resourceCountIs('AWS::Events::Rule', 1);
  template.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'cron(0 12 * * ? *)', State: 'DISABLED' });
  template.resourceCountIs('AWS::SQS::Queue', 2);
  template.hasResourceProperties('AWS::Lambda::EventSourceMapping', { BatchSize: 1, Enabled: false });
  template.hasResourceProperties('AWS::IAM::Policy', { PolicyDocument: Match.objectLike({ Statement: Match.arrayWith([
    Match.objectLike({ Action: ['rds-data:ExecuteStatement', 'rds-data:BeginTransaction', 'rds-data:CommitTransaction', 'rds-data:RollbackTransaction'], Resource: Match.anyValue() }),
  ]) }) });
});
