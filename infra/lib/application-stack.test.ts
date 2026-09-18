import test from 'node:test';
import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Template } from 'aws-cdk-lib/assertions';
import { ApplicationStack } from './application-stack.js';

test('crea ingress YCloud con API REST, Lambda y DynamoDB idempotente', () => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'ApplicationTestDependencies');
  const runtimeConfig = new secretsmanager.Secret(stack, 'RuntimeConfig');
  const application = new ApplicationStack(app, 'ApplicationTest', {
    stage: 'dev',
    runtimeConfig,
    runtimeConfigEncryptionKeyArn: 'arn:aws:kms:us-east-1:123456789012:key/test-key',
  });
  const template = Template.fromStack(application);

  template.resourceCountIs('AWS::DynamoDB::Table', 1);
  template.resourceCountIs('AWS::Lambda::Function', 3);
  template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
  template.resourceCountIs('AWS::SQS::Queue', 2);
  template.resourceCountIs('AWS::Lambda::EventSourceMapping', 2);
  template.hasResourceProperties('AWS::ApiGateway::Method', {
    HttpMethod: 'POST',
    AuthorizationType: 'NONE',
  });
});
