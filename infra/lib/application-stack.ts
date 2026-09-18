import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'node:path';
import type { DeploymentStage } from './environment.js';

export interface ApplicationStackProps extends cdk.StackProps {
  stage: DeploymentStage;
  runtimeConfig: secretsmanager.Secret;
  runtimeConfigEncryptionKeyArn: string;
}

/** Infraestructura de ingress pública; no configura dominios ni modifica YCloud. */
export class ApplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);
    cdk.Tags.of(this).add('Application', 'cuentas-pagar');
    cdk.Tags.of(this).add('Environment', props.stage);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    const inboundEvents = new dynamodb.Table(this, 'InboundEvents', {
      partitionKey: { name: 'event_key', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expires_at',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const webhookIngress = new lambda.Function(this, 'YCloudWebhookIngress', {
      runtime: lambda.Runtime.NODEJS_22_X,
      code: lambda.Code.fromAsset(path.resolve(process.cwd(), 'dist/src/webhooks')),
      handler: 'ycloud-webhook-handler.handler',
      timeout: cdk.Duration.seconds(6),
      memorySize: 256,
      environment: {
        INBOUND_EVENTS_TABLE_NAME: inboundEvents.tableName,
        RUNTIME_CONFIG_SECRET_ARN: props.runtimeConfig.secretArn,
      },
    });
    inboundEvents.grantWriteData(webhookIngress);
    webhookIngress.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [props.runtimeConfig.secretArn],
    }));
    webhookIngress.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions: ['kms:Decrypt'],
      resources: [props.runtimeConfigEncryptionKeyArn],
    }));

    const api = new apigateway.RestApi(this, 'PublicApi', {
      restApiName: `cuentas-pagar-${props.stage}`,
      deployOptions: { stageName: props.stage, tracingEnabled: true },
      endpointConfiguration: { types: [apigateway.EndpointType.REGIONAL] },
    });
    const webhook = api.root.addResource('api').addResource('webhook').addResource('ycloud');
    webhook.addMethod('POST', new apigateway.LambdaIntegration(webhookIngress), {
      authorizationType: apigateway.AuthorizationType.NONE,
    });

    new cdk.CfnOutput(this, 'YCloudWebhookInvokeUrl', {
      value: `${api.url}api/webhook/ycloud`,
      description: 'URL administrada para pruebas; no sustituye el dominio actual de YCloud.',
    });
    new cdk.CfnOutput(this, 'InboundEventsTableName', { value: inboundEvents.tableName });
  }
}
