import test from 'node:test';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DataStack } from './data-stack.js';

test('prepara datos privados cifrados y acceso sólo mediante RDS Proxy', () => {
  const app = new cdk.App();
  const stack = new DataStack(app, 'DataTest', { stage: 'dev' });
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::RDS::DBCluster', 1);
  template.resourceCountIs('AWS::RDS::DBProxy', 1);
  template.resourceCountIs('AWS::S3::Bucket', 1);
  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true,
    },
  });
  template.hasResourceProperties('AWS::RDS::DBProxy', { RequireTLS: true });
});
