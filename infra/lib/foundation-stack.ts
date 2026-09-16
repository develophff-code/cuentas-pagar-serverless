import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { DeploymentStage } from './environment.js';

export interface FoundationStackProps extends cdk.StackProps {
  stage: DeploymentStage;
}

/**
 * Fundaciones sin recursos de negocio. Las fases siguientes agregan Cognito,
 * VPC, Aurora, S3, SQS y Lambda a esta stack por ambiente.
 */
export class FoundationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('Application', 'cuentas-pagar');
    cdk.Tags.of(this).add('Environment', props.stage);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    new cdk.CfnOutput(this, 'DeploymentStage', {
      value: props.stage,
      description: 'Ambiente lógico del despliegue.',
    });

    new cdk.CfnOutput(this, 'TargetRegion', {
      value: cdk.Stack.of(this).region,
      description: 'Región objetivo para la infraestructura.',
    });
  }
}

