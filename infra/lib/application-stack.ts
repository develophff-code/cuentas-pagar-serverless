import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
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
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const conversationDlq = new sqs.Queue(this, 'ConversationDeadLetterQueue', {
      fifo: true,
      contentBasedDeduplication: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const outboxDlq = new sqs.Queue(this, 'OutboxDeadLetterQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const conversationQueue = new sqs.Queue(this, 'ConversationQueue', {
      fifo: true,
      contentBasedDeduplication: false,
      deduplicationScope: sqs.DeduplicationScope.MESSAGE_GROUP,
      fifoThroughputLimit: sqs.FifoThroughputLimit.PER_MESSAGE_GROUP_ID,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
      visibilityTimeout: cdk.Duration.seconds(180),
      deadLetterQueue: { queue: conversationDlq, maxReceiveCount: 5 },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const webhookIngressLogGroup = new logs.LogGroup(this, 'WebhookIngressLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const outboxRelayLogGroup = new logs.LogGroup(this, 'OutboxRelayLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const conversationWorkerLogGroup = new logs.LogGroup(this, 'ConversationWorkerLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const webhookIngress = new lambda.Function(this, 'YCloudWebhookIngress', {
      runtime: lambda.Runtime.NODEJS_22_X,
      code: lambda.Code.fromAsset(path.resolve(process.cwd(), 'dist/src/webhooks')),
      handler: 'ycloud-webhook-handler.handler',
      timeout: cdk.Duration.seconds(6),
      memorySize: 256,
      logGroup: webhookIngressLogGroup as unknown as logs.ILogGroupRef,
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

    const outboxRelay = new lambda.Function(this, 'YCloudOutboxRelay', {
      runtime: lambda.Runtime.NODEJS_22_X,
      code: lambda.Code.fromAsset(path.resolve(process.cwd(), 'dist/src/webhooks')),
      handler: 'ycloud-outbox-relay.handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: outboxRelayLogGroup as unknown as logs.ILogGroupRef,
      environment: { CONVERSATION_QUEUE_URL: conversationQueue.queueUrl },
    });
    inboundEvents.grantStreamRead(outboxRelay);
    conversationQueue.grantSendMessages(outboxRelay);
    new lambda.EventSourceMapping(this, 'InboundEventsOutboxMapping', {
      target: outboxRelay,
      eventSourceArn: inboundEvents.tableStreamArn!,
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 10,
      retryAttempts: 5,
      bisectBatchOnError: true,
      onFailure: {
        bind: (_mapping, target) => {
          outboxDlq.grantSendMessages(target);
          return { destination: outboxDlq.queueArn };
        },
      },
    });

    const conversationWorker = new lambda.Function(this, 'ConversationWorker', {
      runtime: lambda.Runtime.NODEJS_22_X,
      code: lambda.Code.fromAsset(path.resolve(process.cwd(), 'dist/src/webhooks')),
      handler: 'conversation-worker.handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: conversationWorkerLogGroup as unknown as logs.ILogGroupRef,
    });
    conversationQueue.grantConsumeMessages(conversationWorker);
    new lambda.EventSourceMapping(this, 'ConversationWorkerMapping', {
      target: conversationWorker,
      eventSourceArn: conversationQueue.queueArn,
      batchSize: 1,
      reportBatchItemFailures: true,
    });
    webhookIngress.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions: ['kms:Decrypt'],
      resources: [props.runtimeConfigEncryptionKeyArn],
    }));

    const alarmDefaults = {
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    };
    conversationDlq.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(5) }).createAlarm(this, 'ConversationDlqMessagesAlarm', {
      ...alarmDefaults, threshold: 1, comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'La DLQ conversacional contiene mensajes para revisar o reprocesar.',
    });
    outboxDlq.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(5) }).createAlarm(this, 'OutboxDlqMessagesAlarm', {
      ...alarmDefaults, threshold: 1, comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'El relay outbox descartó eventos que requieren replay controlado.',
    });
    webhookIngress.metricErrors({ period: cdk.Duration.minutes(5) }).createAlarm(this, 'WebhookIngressErrorsAlarm', {
      ...alarmDefaults, threshold: 1, comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'El ingreso de webhooks YCloud tuvo errores de ejecución.',
    });
    new cloudwatch.Alarm(this, 'OutboxIteratorAgeAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Lambda', metricName: 'IteratorAge', statistic: 'Maximum', period: cdk.Duration.minutes(5),
        dimensionsMap: { FunctionName: outboxRelay.functionName },
      }),
      ...alarmDefaults,
      threshold: 300_000,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'El relay outbox acumula más de cinco minutos de retraso en DynamoDB Streams.',
    });

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
