import assert from 'node:assert/strict';
import test from 'node:test';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { FoundationStack } from './foundation-stack.js';

test('dev incluye cifrado, secreto de runtime y presupuesto mensual', () => {
  const app = new cdk.App();
  const stack = new FoundationStack(app, 'FoundationDevTest', { stage: 'dev' });
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::KMS::Key', 1);
  template.resourceCountIs('AWS::SecretsManager::Secret', 1);
  template.resourceCountIs('AWS::Budgets::Budget', 1);
  template.hasResourceProperties('AWS::Budgets::Budget', {
    Budget: { BudgetLimit: { Amount: 20, Unit: 'USD' }, TimeUnit: 'MONTHLY' },
  });
  assert.ok(true);
});
