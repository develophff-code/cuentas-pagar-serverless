import * as cdk from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { DEV_MONTHLY_BUDGET_USD, type DeploymentStage } from './environment.js';

export interface FoundationStackProps extends cdk.StackProps {
  stage: DeploymentStage;
}

/**
 * Fundaciones sin recursos de negocio. Las fases siguientes agregan Cognito,
 * VPC, Aurora, S3, SQS y Lambda a esta stack por ambiente.
 */
export class FoundationStack extends cdk.Stack {
  public readonly runtimeConfig: secretsmanager.Secret;
  public readonly encryptionKeyArn: string;

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

    const encryptionKey = new kms.Key(this, 'ApplicationEncryptionKey', {
      alias: `alias/cuentas-pagar-${props.stage}`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      description: `Cifrado de aplicación Cuentas a Pagar (${props.stage}).`,
    });
    this.encryptionKeyArn = encryptionKey.keyArn;

    this.runtimeConfig = new secretsmanager.Secret(this, 'RuntimeConfiguration', {
      secretName: `cuentas-pagar/${props.stage}/runtime-config`,
      encryptionKey,
      description: 'Contenedor de secretos de runtime. Los valores reales se agregan por ambiente.',
      generateSecretString: {
        secretStringTemplate: '{"status":"bootstrap"}',
        generateStringKey: 'bootstrapNonce',
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    if (props.stage === 'dev') {
      const budgetAlertEmail = new cdk.CfnParameter(this, 'BudgetAlertEmail', {
        type: 'String',
        description: 'Email que recibe las alertas de presupuesto del ambiente dev.',
        allowedPattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
      });
      new budgets.CfnBudget(this, 'MonthlyCostBudget', {
        budget: {
          budgetName: 'cuentas-pagar-dev-monthly-cost',
          budgetLimit: { amount: DEV_MONTHLY_BUDGET_USD, unit: 'USD' },
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
        },
        notificationsWithSubscribers: [
          {
            notification: {
              comparisonOperator: 'GREATER_THAN',
              notificationType: 'ACTUAL',
              threshold: 80,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ address: budgetAlertEmail.valueAsString, subscriptionType: 'EMAIL' }],
          },
          {
            notification: {
              comparisonOperator: 'GREATER_THAN',
              notificationType: 'FORECASTED',
              threshold: 100,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ address: budgetAlertEmail.valueAsString, subscriptionType: 'EMAIL' }],
          },
        ],
      });
    }

    new cdk.CfnOutput(this, 'ApplicationEncryptionKeyArn', { value: this.encryptionKeyArn });
    new cdk.CfnOutput(this, 'RuntimeConfigurationSecretArn', { value: this.runtimeConfig.secretArn });
  }
}
